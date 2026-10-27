import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  MessageEvent,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  Sse,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  addMembersSchema,
  createChannelSchema,
  editMessageSchema,
  hasRole,
  MAX_CHAT_FILES,
  MAX_TASK_CARDS,
  muteSchema,
  openDmSchema,
  sendMessageSchema,
  updateChannelSchema,
  type ChannelDto,
  type ChatMessageDto,
  type CreateChannelInput,
  type EditMessageInput,
  type InboxEvent,
  type InboxSummaryDto,
  type MessagePageDto,
  type PersonDto,
  type PresenceDto,
  type SendMessageInput,
  type TaskRefDto,
  type ThreadDto,
} from '@workhub/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import { AnalyticsService } from '../analytics/analytics.service';
import { config } from '../config';
import { isUniqueViolation } from '../common/db-errors';
import { AuthContext, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { chatChannels, chatFiles, chatMembers, chatMessages, memberships, projects, tasks, users } from '../db/schema';
import { notify } from '../notifications/notify';
import { RealtimeService } from '../realtime/realtime.service';
import { INLINE_IMAGE_TYPES, sendDownload, StorageService, uploadMeta } from '../storage/storage.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { unreadAnnouncements } from './announcements';
import {
  assertCanPost,
  isStaff,
  loadChannel,
  memberIdsOf,
  messageDto,
  messageDtos,
  readersOf,
  taskIdsInText,
  taskRefs,
  type ChannelRow,
  type MemberRow,
} from './chat';
import { presenceFor } from './presence';

const PAGE = 50;
const before = z.iso.datetime({ offset: true }).optional();
const idList = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').filter(Boolean) : []))
  .pipe(z.array(z.string().uuid()).max(20));

interface ChannelRowWithCounts extends Record<string, unknown> {
  id: string;
  kind: ChannelDto['kind'];
  name: string | null;
  topic: string | null;
  is_default: boolean;
  last_message_at: Date | string | null;
  archived_at: Date | string | null;
  created_by: string | null;
  joined: boolean;
  muted: boolean;
  member_count: number;
  unread: number;
  mentions: number;
}

/** Live work for after the transaction commits. */
type After = { to: string[]; event: InboxEvent }[];

/**
 * The inbox: public and private channels, direct messages (one-to-one and groups),
 * threads, @mentions, files and task cards. Delivery is live over Server-Sent Events.
 * Guests only take part in conversations they've been added to.
 */
@Controller('chat')
@UseGuards(WorkspaceGuard)
@MinRole('guest')
export class ChatController {
  constructor(
    private readonly db: DbService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
    private readonly analytics: AnalyticsService,
  ) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  private flush(ws: WorkspaceContext, after: After) {
    for (const a of after) this.realtime.toPeople(ws.id, a.to, a.event);
  }

  /** Server-Sent Events for the signed-in person. The browser passes ?workspace=. */
  @Sse('events')
  events(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Observable<MessageEvent> {
    return this.realtime.inbox(ws.id, auth.userId, ws.role);
  }

  @Get('summary')
  async summary(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<InboxSummaryDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const mine = await channelDtos(tx, ws, auth.userId, sql`m.user_id is not null and c.archived_at is null`);
      return {
        unread: mine.filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0),
        mentions: mine.reduce((n, c) => n + c.mentions, 0),
        announcements: isStaff(ws) ? await unreadAnnouncements(tx, ws, auth.userId) : 0,
      };
    });
  }

  // ---- Channels and DMs --------------------------------------------------------------

  /** Your channels and DMs, most recent first. Everyone but guests is in #general. */
  @Get('channels')
  async channels(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ChannelDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      if (isStaff(ws)) await ensureGeneral(tx, ws.id, auth.userId);
      return channelDtos(tx, ws, auth.userId, sql`m.user_id is not null and c.archived_at is null`);
    });
  }

  /** Public channels to browse and join. */
  @Get('channels/browse')
  @MinRole('member')
  async browse(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ChannelDto[]> {
    return this.db.withContext(this.ctx(auth, ws), (tx) => channelDtos(tx, ws, auth.userId, sql`c.kind = 'public' and c.archived_at is null`, 'name'));
  }

  @Post('channels')
  @MinRole('member')
  async create(
    @Body(new ZodPipe(createChannelSchema)) body: CreateChannelInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ChannelDto> {
    const id = randomUUID();
    let others: string[] = [];
    try {
      const dto = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
        await assertNameFree(tx, ws.id, body.name);
        // No RETURNING: until its creator is a member, a private channel is invisible even to them.
        await tx.insert(chatChannels).values({
          id,
          workspaceId: ws.id,
          kind: body.private ? 'private' : 'public',
          name: body.name,
          topic: body.topic || null,
          createdBy: auth.userId,
        });
        others = (await workspaceMembers(tx, ws.id, body.memberIds)).filter((u) => u !== auth.userId);
        await tx.insert(chatMembers).values([auth.userId, ...others].map((userId) => ({ workspaceId: ws.id, channelId: id, userId })));
        return channelDto(tx, ws, auth.userId, id);
      });
      this.realtime.toPeople(ws.id, others, { type: 'channel.changed', channelId: id });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`There’s already a channel called #${body.name}.`);
      throw err;
    }
  }

  @Get('channels/:id')
  async channel(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ChannelDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadChannel(tx, ws, auth.userId, id);
      return channelDto(tx, ws, auth.userId, id);
    });
  }

  /** Rename a channel or change its topic: its members can (only admins rename #general). */
  @Patch('channels/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateChannelSchema)) body: z.infer<typeof updateChannelSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ChannelDto> {
    try {
      const { dto, members } = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
        const { channel, member } = await loadChannel(tx, ws, auth.userId, id);
        if (channel.kind === 'dm') throw new BadRequestException('Direct messages don’t have a name or topic.');
        assertCanPost(channel, member);
        if (body.name !== undefined && body.name !== channel.name) {
          if (channel.isDefault && !hasRole(ws.role, 'admin')) throw new ForbiddenException('Only admins can rename #general.');
          await assertNameFree(tx, ws.id, body.name, id);
        }
        await tx
          .update(chatChannels)
          .set({ ...(body.name !== undefined ? { name: body.name } : {}), ...(body.topic !== undefined ? { topic: body.topic || null } : {}) })
          .where(eq(chatChannels.id, id));
        return { dto: await channelDto(tx, ws, auth.userId, id), members: await memberIdsOf(tx, id) };
      });
      this.realtime.toPeople(ws.id, members, { type: 'channel.changed', channelId: id });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`There’s already a channel called #${body.name}.`);
      throw err;
    }
  }

  /** Archive a channel: it becomes read-only and leaves everyone's list. Its creator or an admin. */
  @Post('channels/:id/archive')
  @HttpCode(204)
  async archive(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const members = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { channel } = await loadChannel(tx, ws, auth.userId, id);
      if (channel.kind === 'dm' || channel.isDefault) throw new BadRequestException(channel.isDefault ? '#general can’t be archived.' : 'Direct messages can’t be archived.');
      if (channel.createdBy !== auth.userId && !hasRole(ws.role, 'admin')) throw new ForbiddenException('Only the channel’s creator or an admin can archive it.');
      await tx.update(chatChannels).set({ archivedAt: new Date() }).where(eq(chatChannels.id, id));
      return memberIdsOf(tx, id);
    });
    this.realtime.toPeople(ws.id, members, { type: 'channel.changed', channelId: id });
  }

  @Post('channels/:id/join')
  @MinRole('member')
  async join(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ChannelDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { channel } = await loadChannel(tx, ws, auth.userId, id);
      if (channel.kind !== 'public') throw new NotFoundException('Conversation not found');
      if (channel.archivedAt) throw new ConflictException('This channel is archived.');
      await tx.insert(chatMembers).values({ workspaceId: ws.id, channelId: id, userId: auth.userId }).onConflictDoNothing();
      return channelDto(tx, ws, auth.userId, id);
    });
  }

  @Post('channels/:id/leave')
  @HttpCode(204)
  async leave(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const members = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { channel } = await loadChannel(tx, ws, auth.userId, id);
      if (channel.kind === 'dm') throw new BadRequestException('You can’t leave a direct message. Mute it instead.');
      if (channel.isDefault) throw new BadRequestException('Everyone stays in #general. Mute it instead.');
      await tx.delete(chatMembers).where(and(eq(chatMembers.channelId, id), eq(chatMembers.userId, auth.userId)));
      return memberIdsOf(tx, id);
    });
    this.realtime.toPeople(ws.id, [...members, auth.userId], { type: 'channel.changed', channelId: id });
  }

  @Get('channels/:id/members')
  async members(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PersonDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadChannel(tx, ws, auth.userId, id);
      return tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(chatMembers)
        .innerJoin(users, eq(users.id, chatMembers.userId))
        .where(eq(chatMembers.channelId, id))
        .orderBy(asc(users.name));
    });
  }

  /** Add people to a channel you're in. (For a DM, start a new group DM instead.) */
  @Post('channels/:id/members')
  async addMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addMembersSchema)) body: z.infer<typeof addMembersSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ChannelDto> {
    const { dto, members } = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { channel, member } = await loadChannel(tx, ws, auth.userId, id);
      if (channel.kind === 'dm') throw new BadRequestException('To add people to a direct message, start a new one with everyone in it.');
      assertCanPost(channel, member);
      if (!isStaff(ws)) throw new ForbiddenException('Guests can’t add people to channels.');
      const valid = await workspaceMembers(tx, ws.id, body.userIds);
      if (valid.length > 0) await tx.insert(chatMembers).values(valid.map((userId) => ({ workspaceId: ws.id, channelId: id, userId }))).onConflictDoNothing();
      return { dto: await channelDto(tx, ws, auth.userId, id), members: await memberIdsOf(tx, id) };
    });
    this.realtime.toPeople(ws.id, members, { type: 'channel.changed', channelId: id });
    return dto;
  }

  /** Remove someone from a channel: its creator or an admin. */
  @Delete('channels/:id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const members = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { channel } = await loadChannel(tx, ws, auth.userId, id);
      if (channel.kind === 'dm' || channel.isDefault) throw new BadRequestException('People can’t be removed from this conversation.');
      if (channel.createdBy !== auth.userId && !hasRole(ws.role, 'admin')) throw new ForbiddenException('Only the channel’s creator or an admin can remove people.');
      const members = await memberIdsOf(tx, id);
      await tx.delete(chatMembers).where(and(eq(chatMembers.channelId, id), eq(chatMembers.userId, userId)));
      return members;
    });
    this.realtime.toPeople(ws.id, members, { type: 'channel.changed', channelId: id });
  }

  /** Mark everything in the channel as read (on every device). */
  @Post('channels/:id/read')
  @HttpCode(204)
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const changed = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadChannel(tx, ws, auth.userId, id);
      const rows = await tx
        .update(chatMembers)
        .set({ lastReadAt: new Date() })
        .where(and(eq(chatMembers.channelId, id), eq(chatMembers.userId, auth.userId)))
        .returning({ userId: chatMembers.userId });
      return rows.length > 0;
    });
    if (changed) this.realtime.toPeople(ws.id, [auth.userId], { type: 'channel.read', channelId: id });
  }

  @Post('channels/:id/mute')
  async mute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(muteSchema)) body: z.infer<typeof muteSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ChannelDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { member } = await loadChannel(tx, ws, auth.userId, id);
      if (!member) throw new BadRequestException('Join the channel first.');
      await tx.update(chatMembers).set({ muted: body.muted }).where(and(eq(chatMembers.channelId, id), eq(chatMembers.userId, auth.userId)));
      return channelDto(tx, ws, auth.userId, id);
    });
  }

  /** Opens the DM with these people, creating it the first time. */
  @Post('dm')
  @MinRole('member')
  async dm(
    @Body(new ZodPipe(openDmSchema)) body: z.infer<typeof openDmSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ChannelDto> {
    const open = () =>
      this.db.withContext(this.ctx(auth, ws), async (tx) => {
        const others = (await workspaceMembers(tx, ws.id, body.userIds)).filter((u) => u !== auth.userId);
        if (others.length !== new Set(body.userIds.filter((u) => u !== auth.userId)).size || others.length === 0) {
          throw new BadRequestException('Choose people in this workspace.');
        }
        const everyone = [auth.userId, ...others].sort();
        const dmKey = everyone.join(',');
        const [existing] = await tx
          .select({ id: chatChannels.id })
          .from(chatChannels)
          .where(and(eq(chatChannels.workspaceId, ws.id), eq(chatChannels.dmKey, dmKey)));
        if (existing) return channelDto(tx, ws, auth.userId, existing.id);
        const id = randomUUID();
        await tx.insert(chatChannels).values({ id, workspaceId: ws.id, kind: 'dm', dmKey, createdBy: auth.userId });
        await tx.insert(chatMembers).values(everyone.map((userId) => ({ workspaceId: ws.id, channelId: id, userId })));
        return channelDto(tx, ws, auth.userId, id);
      });
    try {
      return await open();
    } catch (err) {
      // Both people opened it at once: the other request created it.
      if (isUniqueViolation(err)) return open();
      throw err;
    }
  }

  // ---- Messages ----------------------------------------------------------------------

  /** Top-level messages, newest page first (each page oldest first). Pass ?before= for older ones. */
  @Get('channels/:id/messages')
  async messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('before') beforeParam: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<MessagePageDto> {
    const parsed = before.safeParse(beforeParam || undefined);
    if (!parsed.success) throw new BadRequestException('before must be a date and time');
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadChannel(tx, ws, auth.userId, id);
      const rows = await tx
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.channelId, id),
            isNull(chatMessages.parentId),
            parsed.data ? lt(chatMessages.createdAt, new Date(parsed.data)) : undefined,
          ),
        )
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(PAGE + 1);
      const page = rows.slice(0, PAGE).reverse();
      return { messages: await messageDtos(tx, ws.id, page), hasMore: rows.length > PAGE };
    });
  }

  @Post('channels/:id/messages')
  @UseInterceptors(FilesInterceptor('files', MAX_CHAT_FILES, { limits: { fileSize: config.maxUploadBytes, files: MAX_CHAT_FILES, fields: 10 } }))
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(sendMessageSchema)) body: SendMessageInput,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ChatMessageDto> {
    const uploads = (files ?? []).filter((f) => f.size > 0);
    if (!body.body && uploads.length === 0) throw new BadRequestException('Write a message or attach a file.');
    const messageId = randomUUID();
    const stored: string[] = [];
    const after: After = [];
    let kind: ChannelRow['kind'] = 'public';
    try {
      const dto = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
        const { channel, member } = await loadChannel(tx, ws, auth.userId, id);
        assertCanPost(channel, member);
        kind = channel.kind;
        let parent: typeof chatMessages.$inferSelect | undefined;
        if (body.parentId) {
          [parent] = await tx
            .select()
            .from(chatMessages)
            .where(and(eq(chatMessages.id, body.parentId), eq(chatMessages.channelId, id)));
          if (!parent || parent.parentId) throw new BadRequestException('Reply to a message in this conversation.');
          if (parent.deletedAt) throw new ConflictException('That message was deleted.');
        }
        const readers = await readersOf(tx, ws.id, channel);
        const mentions = [...new Set(body.mentions)].filter((u) => readers.has(u));
        const taskIds = await cardIds(tx, ws, auth.userId, [...body.taskIds, ...taskIdsInText(body.body)]);
        const now = new Date();
        await tx.insert(chatMessages).values({
          id: messageId,
          workspaceId: ws.id,
          channelId: id,
          authorId: auth.userId,
          parentId: parent?.id ?? null,
          body: body.body,
          mentions,
          taskIds,
          createdAt: now,
        });
        for (const file of uploads) {
          const { fileName, contentType } = uploadMeta(file);
          const key = `${ws.id}/chat/${id}/${randomUUID()}`;
          await this.storage.put(key, file.buffer, contentType);
          stored.push(key);
          await tx.insert(chatFiles).values({ workspaceId: ws.id, channelId: id, messageId, uploadedBy: auth.userId, fileName, contentType, sizeBytes: file.size, storageKey: key });
        }
        if (parent) {
          await tx
            .update(chatMessages)
            .set({ replyCount: sql`${chatMessages.replyCount} + 1`, lastReplyAt: now })
            .where(eq(chatMessages.id, parent.id));
        } else {
          await tx.update(chatChannels).set({ lastMessageAt: now }).where(eq(chatChannels.id, id));
        }
        // What you write yourself isn't unread for you.
        await tx.update(chatMembers).set({ lastReadAt: now }).where(and(eq(chatMembers.channelId, id), eq(chatMembers.userId, auth.userId)));

        const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
        const where = channel.kind === 'dm' ? 'a direct message' : `#${channel.name}`;
        const link = `/app/inbox?c=${id}${parent ? `&thread=${parent.id}` : ''}`;
        const snippet = body.body ? (body.body.length > 120 ? `${body.body.slice(0, 117)}…` : body.body) : `${uploads.length} file${uploads.length === 1 ? '' : 's'}`;
        const mentioned = mentions.filter((u) => u !== auth.userId);
        await notify(tx, ws.id, mentioned, { type: 'chat.mention', title: `${me!.name} mentioned you in ${where}`, body: snippet, link });
        if (parent?.authorId && parent.authorId !== auth.userId && !mentioned.includes(parent.authorId) && readers.has(parent.authorId)) {
          await notify(tx, ws.id, [parent.authorId], { type: 'chat.reply', title: `${me!.name} replied to your message in ${where}`, body: snippet, link });
        }

        const message = await messageDto(tx, ws.id, messageId);
        const to = await memberIdsOf(tx, id);
        after.push({ to, event: { type: 'message.created', message } });
        if (parent) after.push({ to, event: { type: 'message.updated', message: await messageDto(tx, ws.id, parent.id) } });
        return message;
      });
      this.flush(ws, after);
      this.analytics.capture('message sent', { userId: auth.userId, workspaceId: ws.id }, { kind, reply: !!body.parentId, files: uploads.length, taskCards: dto.taskIds.length });
      return dto;
    } catch (err) {
      // The database rolled back, so don't leave orphaned files behind.
      for (const key of stored) await this.storage.delete(key).catch(() => {});
      throw err;
    }
  }

  /** Edit your own message. */
  @Patch('messages/:id')
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(editMessageSchema)) body: EditMessageInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ChatMessageDto> {
    const after: After = [];
    const dto = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { message, channel, member } = await loadMessage(tx, ws, auth.userId, id);
      if (message.authorId !== auth.userId) throw new ForbiddenException('You can only edit your own messages.');
      if (message.deletedAt) throw new ConflictException('That message was deleted.');
      assertCanPost(channel, member);
      const readers = await readersOf(tx, ws.id, channel);
      await tx
        .update(chatMessages)
        .set({
          body: body.body,
          mentions: [...new Set(body.mentions)].filter((u) => readers.has(u)),
          taskIds: await cardIds(tx, ws, auth.userId, [...body.taskIds, ...taskIdsInText(body.body)]),
          editedAt: new Date(),
        })
        .where(eq(chatMessages.id, id));
      const updated = await messageDto(tx, ws.id, id);
      after.push({ to: await memberIdsOf(tx, channel.id), event: { type: 'message.updated', message: updated } });
      return updated;
    });
    this.flush(ws, after);
    return dto;
  }

  /** Delete a message: its author, or an admin in a channel (never in someone's DMs). */
  @Delete('messages/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const after: After = [];
    const keys = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { message, channel } = await loadMessage(tx, ws, auth.userId, id);
      const moderator = channel.kind !== 'dm' && hasRole(ws.role, 'admin');
      if (message.authorId !== auth.userId && !moderator) throw new ForbiddenException('You can only delete your own messages.');
      if (message.deletedAt) return [];
      const files = await tx.delete(chatFiles).where(eq(chatFiles.messageId, id)).returning({ key: chatFiles.storageKey });
      await tx.update(chatMessages).set({ body: '', mentions: [], taskIds: [], deletedAt: new Date() }).where(eq(chatMessages.id, id));
      after.push({ to: await memberIdsOf(tx, channel.id), event: { type: 'message.updated', message: await messageDto(tx, ws.id, id) } });
      return files.map((f) => f.key);
    });
    this.flush(ws, after);
    for (const key of keys) await this.storage.delete(key).catch(() => {});
  }

  /** A message and its replies (given a reply, its thread). */
  @Get('messages/:id/thread')
  async thread(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ThreadDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const { message } = await loadMessage(tx, ws, auth.userId, id);
      const rootId = message.parentId ?? message.id;
      const [root] = await messageDtos(tx, ws.id, (await tx.select().from(chatMessages).where(eq(chatMessages.id, rootId))) as (typeof chatMessages.$inferSelect)[]);
      const replies = await tx.select().from(chatMessages).where(eq(chatMessages.parentId, rootId)).orderBy(asc(chatMessages.createdAt), asc(chatMessages.id)).limit(500);
      return { root: root!, replies: await messageDtos(tx, ws.id, replies) };
    });
  }

  /** A file shared in a conversation, to anyone who can read it. */
  @Get('files/:id')
  async file(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @Res() res: Response) {
    const file = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [f] = await tx.select().from(chatFiles).where(and(eq(chatFiles.id, id), eq(chatFiles.workspaceId, ws.id)));
      if (!f) throw new NotFoundException('File not found');
      await loadChannel(tx, ws, auth.userId, f.channelId);
      return f;
    });
    const result = await this.storage.download(file.storageKey, { fileName: file.fileName, contentType: file.contentType, inline: INLINE_IMAGE_TYPES.has(file.contentType) });
    sendDownload(res, result, file);
  }

  // ---- Task cards, people and presence -------------------------------------------------

  /** Cards for tasks mentioned in messages; tasks you can't see are left out. */
  @Get('task-refs')
  async taskRefs(@Query('ids') ids: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TaskRefDto[]> {
    const parsed = idList.safeParse(ids);
    if (!parsed.success) throw new BadRequestException('ids must be up to 20 task ids, comma-separated');
    return this.db.withContext(this.ctx(auth, ws), (tx) => taskRefs(tx, ws, auth.userId, parsed.data));
  }

  /** Tasks to pick when typing "#" in a message. */
  @Get('tasks')
  async searchTasks(@Query('q') q: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TaskRefDto[]> {
    const term = (q ?? '').trim().slice(0, 100);
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const rows = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(
          and(
            eq(tasks.workspaceId, ws.id),
            isNull(tasks.deletedAt),
            ne(projects.status, 'archived'),
            term ? ilike(tasks.title, `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
          ),
        )
        .orderBy(desc(tasks.updatedAt))
        .limit(isStaff(ws) ? 8 : 50);
      return (await taskRefs(tx, ws, auth.userId, rows.map((r) => r.id))).slice(0, 8);
    });
  }

  /** Everyone in the workspace, to message or @mention. */
  @Get('people')
  @MinRole('member')
  async people(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PersonDto[]> {
    return this.db.withContext(this.ctx(auth, ws), (tx) =>
      tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.workspaceId, ws.id))
        .orderBy(asc(users.name)),
    );
  }

  /** Who's in, on a break, out or on leave, from today's attendance. */
  @Get('presence')
  @MinRole('member')
  async presence(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PresenceDto[]> {
    return this.db.withContext(this.ctx(auth, ws), (tx) => presenceFor(tx, ws.id));
  }
}

// ---- Helpers ---------------------------------------------------------------------------

async function loadMessage(tx: Tx, ws: WorkspaceContext, userId: string, messageId: string) {
  const [message] = await tx
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.workspaceId, ws.id)));
  if (!message) throw new NotFoundException('Message not found');
  const { channel, member } = await loadChannel(tx, ws, userId, message.channelId);
  return { message, channel, member: member as MemberRow | null };
}

/** The ids among `ids` that belong to people in the workspace. */
async function workspaceMembers(tx: Tx, workspaceId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.userId, unique)));
  return rows.map((r) => r.userId);
}

/** Task cards a message may show: ones the sender can see, at most MAX_TASK_CARDS. */
async function cardIds(tx: Tx, ws: WorkspaceContext, userId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((i) => i.toLowerCase()))].slice(0, MAX_TASK_CARDS * 2);
  return (await taskRefs(tx, ws, userId, unique)).map((t) => t.id).slice(0, MAX_TASK_CARDS);
}

async function assertNameFree(tx: Tx, workspaceId: string, name: string, exceptId?: string) {
  const [taken] = await tx
    .select({ id: chatChannels.id })
    .from(chatChannels)
    .where(and(eq(chatChannels.workspaceId, workspaceId), ne(chatChannels.kind, 'dm'), sql`lower(${chatChannels.name}) = ${name.toLowerCase()}`));
  // A private channel you're not in is invisible here; the unique index still catches it.
  if (taken && taken.id !== exceptId) throw new ConflictException(`There’s already a channel called #${name}.`);
}

/** #general exists in every workspace, and everyone but guests is in it. */
async function ensureGeneral(tx: Tx, workspaceId: string, userId: string) {
  const find = () =>
    tx
      .select({ id: chatChannels.id })
      .from(chatChannels)
      .where(and(eq(chatChannels.workspaceId, workspaceId), eq(chatChannels.isDefault, true)));
  let [general] = await find();
  if (!general) {
    await tx
      .insert(chatChannels)
      .values({ id: randomUUID(), workspaceId, kind: 'public', name: 'general', topic: 'Everyone in the workspace', isDefault: true })
      .onConflictDoNothing();
    [general] = await find();
  }
  if (general) await tx.insert(chatMembers).values({ workspaceId, channelId: general.id, userId }).onConflictDoNothing();
}

async function channelDto(tx: Tx, ws: WorkspaceContext, userId: string, channelId: string): Promise<ChannelDto> {
  const [dto] = await channelDtos(tx, ws, userId, sql`c.id = ${channelId}`);
  if (!dto) throw new NotFoundException('Conversation not found');
  return dto;
}

/** Channels matching `filter` (over c: channel, m: your membership), with your unread counts. */
async function channelDtos(tx: Tx, ws: WorkspaceContext, userId: string, filter: SQL, order: 'recent' | 'name' = 'recent'): Promise<ChannelDto[]> {
  const { rows } = await tx.execute<ChannelRowWithCounts>(sql`
    select c.id, c.kind, c.name, c.topic, c.is_default, c.last_message_at, c.archived_at, c.created_by,
      m.user_id is not null as joined,
      coalesce(m.muted, false) as muted,
      (select count(*)::int from chat_members x where x.channel_id = c.id) as member_count,
      case when m.user_id is null then 0 else (
        select count(*)::int from chat_messages x
        where x.channel_id = c.id and x.parent_id is null and x.deleted_at is null
          and x.created_at > m.last_read_at and x.author_id is distinct from ${userId}::uuid
      ) end as unread,
      case when m.user_id is null then 0 else (
        select count(*)::int from chat_messages x
        where x.channel_id = c.id and x.deleted_at is null and x.created_at > m.last_read_at
          and ${userId}::uuid = any(x.mentions) and x.author_id is distinct from ${userId}::uuid
      ) end as mentions
    from chat_channels c
    left join chat_members m on m.channel_id = c.id and m.user_id = ${userId}::uuid
    where c.workspace_id = ${ws.id}::uuid and ${filter}
    order by ${order === 'name' ? sql`c.name` : sql`c.is_default desc, coalesce(c.last_message_at, c.created_at) desc`}
    limit 500
  `);
  // Guests only see conversations they're in.
  const visible = isStaff(ws) ? rows : rows.filter((r) => r.joined);
  const dmIds = visible.filter((r) => r.kind === 'dm').map((r) => r.id);
  const dmPeople = dmIds.length
    ? await tx
        .select({ channelId: chatMembers.channelId, id: users.id, name: users.name, email: users.email })
        .from(chatMembers)
        .innerJoin(users, eq(users.id, chatMembers.userId))
        .where(and(inArray(chatMembers.channelId, dmIds), ne(chatMembers.userId, userId)))
        .orderBy(asc(users.name))
    : [];
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return visible.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    topic: r.topic,
    isDefault: r.is_default,
    people: dmPeople.filter((p) => p.channelId === r.id).map(({ id, name, email }) => ({ id, name, email })),
    memberCount: r.member_count,
    joined: r.joined,
    muted: r.muted,
    unread: r.unread,
    mentions: r.mentions,
    lastMessageAt: iso(r.last_message_at),
    archived: r.archived_at !== null,
    createdById: r.created_by,
  }));
}
