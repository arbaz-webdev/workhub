// Shared helpers for the inbox: channel access, who may read a channel, and DTOs.
// All run inside the caller's tenant transaction, where RLS already hides private
// channels and DMs the caller isn't in.
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { hasRole, type ChatMessageDto, type PersonDto, type TaskRefDto } from '@workhub/shared';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { WorkspaceContext } from '../common/request';
import type { Tx } from '../db/db.service';
import { boardColumns, chatChannels, chatFiles, chatMembers, chatMessages, memberships, projectMembers, projects, taskAssignees, tasks, users } from '../db/schema';
import { INLINE_IMAGE_TYPES } from '../storage/storage.service';

export type ChannelRow = typeof chatChannels.$inferSelect;
export type MemberRow = typeof chatMembers.$inferSelect;
export type MessageRow = typeof chatMessages.$inferSelect;

export const isStaff = (ws: WorkspaceContext) => hasRole(ws.role, 'member');

/**
 * A channel the caller can read, and their membership. Private channels and DMs they
 * aren't in don't exist for them (RLS); guests also can't see public channels they
 * weren't added to. Unknown and forbidden look the same: 404.
 */
export async function loadChannel(tx: Tx, ws: WorkspaceContext, userId: string, channelId: string): Promise<{ channel: ChannelRow; member: MemberRow | null }> {
  const [channel] = await tx
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.id, channelId), eq(chatChannels.workspaceId, ws.id)));
  if (!channel) throw new NotFoundException('Conversation not found');
  const [member] = await tx
    .select()
    .from(chatMembers)
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)));
  if (!member && !isStaff(ws)) throw new NotFoundException('Conversation not found');
  return { channel, member: member ?? null };
}

export function assertCanPost(channel: ChannelRow, member: MemberRow | null) {
  if (channel.archivedAt) throw new ConflictException('This channel is archived.');
  if (!member) throw new ForbiddenException('Join the channel to post in it.');
}

export async function memberIdsOf(tx: Tx, channelId: string): Promise<string[]> {
  const rows = await tx.select({ userId: chatMembers.userId }).from(chatMembers).where(eq(chatMembers.channelId, channelId));
  return rows.map((r) => r.userId);
}

/** Everyone who may read the channel: its members, plus all staff for a public one. */
export async function readersOf(tx: Tx, workspaceId: string, channel: ChannelRow): Promise<Set<string>> {
  const readers = new Set(await memberIdsOf(tx, channel.id));
  if (channel.kind === 'public') {
    const staff = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), ne(memberships.role, 'guest')));
    for (const s of staff) readers.add(s.userId);
  }
  return readers;
}

export async function peopleById(tx: Tx, ids: string[]): Promise<Map<string, PersonDto>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((u) => [u.id, u]));
}

export async function messageDtos(tx: Tx, workspaceId: string, rows: MessageRow[]): Promise<ChatMessageDto[]> {
  if (rows.length === 0) return [];
  const authors = await peopleById(
    tx,
    rows.map((r) => r.authorId).filter((id): id is string => !!id),
  );
  const files = await tx
    .select()
    .from(chatFiles)
    .where(
      inArray(
        chatFiles.messageId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(chatFiles.createdAt));
  return rows.map((m) => ({
    id: m.id,
    channelId: m.channelId,
    parentId: m.parentId,
    author: m.authorId ? (authors.get(m.authorId) ?? null) : null,
    body: m.deletedAt ? '' : m.body,
    mentions: m.deletedAt ? [] : m.mentions,
    taskIds: m.deletedAt ? [] : m.taskIds,
    files: files
      .filter((f) => f.messageId === m.id)
      .map((f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        url: `/chat/files/${f.id}?workspace=${workspaceId}`,
        isImage: INLINE_IMAGE_TYPES.has(f.contentType),
      })),
    replyCount: m.replyCount,
    lastReplyAt: m.lastReplyAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deleted: m.deletedAt !== null,
  }));
}

export async function messageDto(tx: Tx, workspaceId: string, messageId: string): Promise<ChatMessageDto> {
  const [row] = await tx.select().from(chatMessages).where(eq(chatMessages.id, messageId));
  return (await messageDtos(tx, workspaceId, [row!]))[0]!;
}

/** Task links pasted into a message (…/app/projects/<id>?task=<id>) count as task cards. */
export function taskIdsInText(body: string): string[] {
  return [...body.matchAll(/[?&]task=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)].map((m) => m[1]!.toLowerCase());
}

/** The tasks among `ids` that the caller may see, as cards. Guests only see their projects' tasks. */
export async function taskRefs(tx: Tx, ws: WorkspaceContext, userId: string, ids: string[]): Promise<TaskRefDto[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  let rows = await tx
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      projectName: projects.name,
      columnName: boardColumns.name,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .where(and(eq(tasks.workspaceId, ws.id), inArray(tasks.id, unique), isNull(tasks.deletedAt)));
  if (!isStaff(ws) && rows.length > 0) {
    const mine = await tx
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.workspaceId, ws.id)));
    const allowed = new Set(mine.map((p) => p.projectId));
    rows = rows.filter((r) => allowed.has(r.projectId));
  }
  if (rows.length === 0) return [];
  const assigned = await tx
    .select({ taskId: taskAssignees.taskId, id: users.id, name: users.name, email: users.email })
    .from(taskAssignees)
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(
      inArray(
        taskAssignees.taskId,
        rows.map((r) => r.id),
      ),
    );
  const order = new Map(unique.map((id, i) => [id, i]));
  return rows
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((r) => ({
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      columnName: r.columnName,
      priority: r.priority,
      dueDate: r.dueDate,
      completed: r.completedAt !== null,
      assignees: assigned.filter((a) => a.taskId === r.id).map(({ id, name, email }) => ({ id, name, email })),
    }));
}

/** "Ali, Sara and 2 others" for a DM's title. */
export function dmTitle(people: PersonDto[]): string {
  const names = people.map((p) => p.name);
  if (names.length <= 2) return names.join(' and ') || 'Just you';
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} other${names.length === 3 ? '' : 's'}`;
}
