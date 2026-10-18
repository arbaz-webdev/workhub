import type { Tx } from '../db/db.service';
import { auditLogs } from '../db/schema';

export interface AuditEntry {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/** Records an audit event inside the caller's tenant transaction. */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    workspaceId: entry.workspaceId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata ?? {},
    ip: entry.ip,
  });
}
