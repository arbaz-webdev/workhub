import { BadRequestException, Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { AUDIT_ACTION_LABELS, type AuditLogDto, type AuditLogPage } from '@workhub/shared';
import { and, desc, eq, sql, SQL } from 'drizzle-orm';
import { AuthContext, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { DbService, Tx } from '../db/db.service';
import { auditLogs, users } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quotes a CSV cell and defuses spreadsheet formulas (=, +, -, @) from user-supplied text. */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** The workspace's audit trail, for admins and the owner. */
@Controller('audit-logs')
@UseGuards(WorkspaceGuard)
@MinRole('admin')
export class AuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('before') before?: string,
    @Query('action') action?: string,
  ): Promise<AuditLogPage> {
    if (before && !UUID.test(before)) throw new BadRequestException('Invalid cursor');
    const cursor = before || undefined;
    const rows = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      this.query(tx, ws.id, { cursor, action, limit: PAGE_SIZE + 1 }),
    );
    const items = rows.slice(0, PAGE_SIZE);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > PAGE_SIZE && last ? last.id : null,
    };
  }

  @Get('export')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="audit-log.csv"')
  async export(
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('action') action?: string,
  ): Promise<string> {
    const rows = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      this.query(tx, ws.id, { action, limit: EXPORT_LIMIT }),
    );
    const header = ['Time (UTC)', 'Who', 'Email', 'Action', 'Details', 'IP'];
    const lines = rows.map((r) =>
      [
        r.createdAt,
        r.actorName,
        r.actorEmail,
        AUDIT_ACTION_LABELS[r.action] ?? r.action,
        JSON.stringify(r.metadata),
        r.ip,
      ]
        .map(csvCell)
        .join(','),
    );
    // BOM so Excel opens UTF-8 (Urdu names) correctly.
    return '﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n');
  }

  private async query(
    tx: Tx,
    workspaceId: string,
    opts: { cursor?: string; action?: string; limit: number },
  ): Promise<AuditLogDto[]> {
    const conditions: (SQL | undefined)[] = [eq(auditLogs.workspaceId, workspaceId)];
    if (opts.action) conditions.push(eq(auditLogs.action, opts.action));
    if (opts.cursor) {
      // Keyset pagination compared in SQL, so microsecond timestamps are never rounded.
      conditions.push(
        sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (select created_at, id from audit_logs where id = ${opts.cursor})`,
      );
    }
    const rows = await tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(opts.limit);
    return rows.map((r) => ({
      ...r,
      actorName: r.actorName ?? null,
      actorEmail: r.actorEmail ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
