import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  BUILT_IN_PAYROLL_TEMPLATES,
  deviceMappingSchema,
  memberCodesSchema,
  payrollTemplateSchema,
  type DeviceImportPreviewDto,
  type DeviceImportResultDto,
  type MemberCodesDto,
  type MemberCodesInput,
  type PayrollColumn,
  type PayrollTemplateDto,
  type PayrollTemplateInput,
} from '@workhub/shared';
import { and, asc, eq, ne } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { isUniqueViolation } from '../common/db-errors';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { memberships, payrollTemplates, users } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { workspaceInfo } from './attendance';
import { importPunches, parseDeviceFile, type Punch } from './device-import';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PUNCHES = 200_000;

type TemplateRow = typeof payrollTemplates.$inferSelect;
const templateDto = (t: TemplateRow): PayrollTemplateDto => ({ id: t.id, name: t.name, description: null, columns: t.columns, builtIn: false });

/** The columns for an export: a built-in template's key, a saved template's id, or the full summary. */
export async function exportColumns(tx: Tx, workspaceId: string, template: string | undefined): Promise<PayrollColumn[] | undefined> {
  if (!template) return undefined;
  const builtIn = BUILT_IN_PAYROLL_TEMPLATES.find((t) => t.key === template);
  if (builtIn) return builtIn.columns;
  if (!/^[0-9a-f-]{36}$/i.test(template)) throw new BadRequestException('Unknown template');
  const [row] = await tx.select().from(payrollTemplates).where(and(eq(payrollTemplates.id, template), eq(payrollTemplates.workspaceId, workspaceId)));
  if (!row) throw new NotFoundException('Template not found');
  return row.columns;
}

function readText(file: Express.Multer.File | undefined): string {
  if (!file || file.size === 0) throw new BadRequestException('Choose the file from the device (attlog.dat) or its software (CSV).');
  const text = file.buffer.toString('utf8');
  if (text.includes('\u0000')) throw new BadRequestException('That looks like an Excel or binary file. Save it as CSV, or use attlog.dat from the device.');
  return text;
}

/**
 * Payroll exports and the fingerprint-device import: export templates (managers read,
 * admins change), people's employee codes and device numbers, and importing device punches.
 */
@Controller('attendance/payroll')
@UseGuards(WorkspaceGuard)
@MinRole('admin')
export class PayrollController {
  constructor(private readonly db: DbService) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  @Get('templates')
  @MinRole('manager')
  templates(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PayrollTemplateDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const saved = await tx.select().from(payrollTemplates).where(eq(payrollTemplates.workspaceId, ws.id)).orderBy(asc(payrollTemplates.name));
      return [...BUILT_IN_PAYROLL_TEMPLATES.map((t) => ({ id: t.key, name: t.name, description: t.description, columns: t.columns, builtIn: true })), ...saved.map(templateDto)];
    });
  }

  @Post('templates')
  createTemplate(@Body(new ZodPipe(payrollTemplateSchema)) body: PayrollTemplateInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PayrollTemplateDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      try {
        const [row] = await tx.insert(payrollTemplates).values({ workspaceId: ws.id, name: body.name, columns: body.columns, createdBy: auth.userId }).returning();
        return templateDto(row!);
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('There’s already a template with that name.');
        throw err;
      }
    });
  }

  @Patch('templates/:id')
  updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(payrollTemplateSchema)) body: PayrollTemplateInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PayrollTemplateDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      try {
        const [row] = await tx.update(payrollTemplates).set({ name: body.name, columns: body.columns }).where(and(eq(payrollTemplates.id, id), eq(payrollTemplates.workspaceId, ws.id))).returning();
        if (!row) throw new NotFoundException('Template not found');
        return templateDto(row);
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('There’s already a template with that name.');
        throw err;
      }
    });
  }

  @Delete('templates/:id')
  @HttpCode(204)
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<void> {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const gone = await tx.delete(payrollTemplates).where(and(eq(payrollTemplates.id, id), eq(payrollTemplates.workspaceId, ws.id))).returning({ id: payrollTemplates.id });
      if (gone.length === 0) throw new NotFoundException('Template not found');
    });
  }

  private codes(tx: Tx, workspaceId: string): Promise<MemberCodesDto[]> {
    return tx
      .select({ userId: users.id, name: users.name, email: users.email, employeeCode: memberships.employeeCode, deviceUserId: memberships.deviceUserId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, workspaceId), ne(memberships.role, 'guest')))
      .orderBy(asc(users.name));
  }

  /** Everyone's employee code and device number. */
  @Get('codes')
  listCodes(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<MemberCodesDto[]> {
    return this.db.withContext(this.ctx(auth, ws), (tx) => this.codes(tx, ws.id));
  }

  @Patch('codes/:userId')
  setCodes(@Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(memberCodesSchema)) body: MemberCodesInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<MemberCodesDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      try {
        const updated = await tx
          .update(memberships)
          .set({ employeeCode: body.employeeCode, deviceUserId: body.deviceUserId })
          .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId), ne(memberships.role, 'guest')))
          .returning({ id: memberships.id });
        if (updated.length === 0) throw new NotFoundException('That person isn’t on the team');
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('Someone else already has that code or device number.');
        throw err;
      }
      return this.codes(tx, ws.id);
    });
  }

  /** Reads a device file and matches its people. Nothing is saved. */
  @Post('device-import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5 } }))
  preview(@UploadedFile() file: Express.Multer.File | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<DeviceImportPreviewDto> {
    const parsed = parseDeviceFile(readText(file));
    if (parsed.punches.length === 0) throw new BadRequestException(`No punches found in that file. ${parsed.examples[0] ? `It starts: ${parsed.examples[0].slice(0, 120)}` : ''}`.trim());
    if (parsed.punches.length > MAX_PUNCHES) throw new BadRequestException(`That file has ${parsed.punches.length.toLocaleString()} punches; import at most ${MAX_PUNCHES.toLocaleString()} at a time.`);
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const known = await this.codes(tx, ws.id);
      const people = new Map<string, { name: string | null; punches: number }>();
      for (const p of parsed.punches) {
        const e = people.get(p.deviceUserId) ?? { name: p.name, punches: 0 };
        e.punches += 1;
        people.set(p.deviceUserId, e);
      }
      const dates = parsed.punches.map((p) => p.date).sort();
      return {
        format: parsed.format,
        punches: parsed.punches.length,
        from: dates[0] ?? null,
        to: dates.at(-1) ?? null,
        people: [...people]
          .map(([deviceUserId, e]) => ({ deviceUserId, name: e.name, punches: e.punches, userId: (known.find((k) => k.deviceUserId === deviceUserId) ?? known.find((k) => k.employeeCode === deviceUserId))?.userId ?? null }))
          .sort((a, b) => a.deviceUserId.localeCompare(b.deviceUserId, 'en', { numeric: true })),
        unreadable: parsed.unreadable,
        examples: parsed.examples,
      };
    });
  }

  /**
   * Imports the file's punches for the people matched in `mapping` (device number → person).
   * The matches are saved as people's device numbers, so the next import needs no matching.
   */
  @Post('device-import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5 } }))
  run(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('mapping') mappingJson: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<DeviceImportResultDto> {
    let mapping: Record<string, string | null>;
    try {
      const parsedMapping = deviceMappingSchema.safeParse(JSON.parse(mappingJson ?? '{}'));
      if (!parsedMapping.success) throw new Error();
      mapping = parsedMapping.data;
    } catch {
      throw new BadRequestException('Send the matches as JSON: { "device number": "person id" }');
    }
    const parsed = parseDeviceFile(readText(file));
    if (parsed.punches.length === 0) throw new BadRequestException('No punches found in that file.');
    if (parsed.punches.length > MAX_PUNCHES) throw new BadRequestException(`Import at most ${MAX_PUNCHES.toLocaleString()} punches at a time.`);

    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const team = await this.codes(tx, ws.id);
      const onTeam = new Set(team.map((t) => t.userId));
      const chosen = Object.entries(mapping).filter((e): e is [string, string] => !!e[1]);
      for (const [, userId] of chosen) if (!onTeam.has(userId)) throw new BadRequestException('A match names someone who isn’t on the team.');
      const users = new Set<string>();
      for (const [, userId] of chosen) {
        if (users.has(userId)) throw new BadRequestException('Two device numbers are matched to the same person.');
        users.add(userId);
      }

      // Remember the matches: clear anyone else holding these numbers, then set them.
      for (const [deviceUserId, userId] of chosen) {
        await tx.update(memberships).set({ deviceUserId: null }).where(and(eq(memberships.workspaceId, ws.id), eq(memberships.deviceUserId, deviceUserId), ne(memberships.userId, userId)));
        await tx.update(memberships).set({ deviceUserId }).where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId)));
      }

      const byUser = new Map<string, Punch[]>();
      let unmatchedPunches = 0;
      for (const p of parsed.punches) {
        const userId = mapping[p.deviceUserId];
        if (!userId) {
          unmatchedPunches += 1;
          continue;
        }
        byUser.set(userId, [...(byUser.get(userId) ?? []), p]);
      }
      const result = await importPunches(tx, await workspaceInfo(tx, ws.id), byUser);
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: auth.userId,
        action: 'attendance.device_imported',
        entityType: 'workspace',
        entityId: ws.id,
        metadata: { file: file?.originalname?.slice(0, 100) ?? null, punches: parsed.punches.length, people: byUser.size, ...result, unmatchedPunches },
        ip,
      });
      return { ...result, unmatchedPunches };
    });
  }
}
