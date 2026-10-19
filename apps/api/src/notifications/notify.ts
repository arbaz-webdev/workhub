import { and, eq, inArray } from 'drizzle-orm';
import type { Role } from '@workhub/shared';
import type { Tx } from '../db/db.service';
import { memberships, notifications } from '../db/schema';

export interface NewNotification {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/** Notifies specific people, inside the caller's tenant transaction. */
export async function notify(tx: Tx, workspaceId: string, userIds: string[], n: NewNotification): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  // No RETURNING: RLS only lets the recipient read their notification.
  await tx.insert(notifications).values(unique.map((userId) => ({ workspaceId, userId, ...n })));
}

/** Notifies everyone in the workspace with one of `roles`, except `exceptUserId`. */
export async function notifyRoles(
  tx: Tx,
  workspaceId: string,
  roles: Role[],
  n: NewNotification,
  exceptUserId?: string,
): Promise<void> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.role, roles)));
  await notify(
    tx,
    workspaceId,
    rows.map((r) => r.userId).filter((id) => id !== exceptUserId),
    n,
  );
}
