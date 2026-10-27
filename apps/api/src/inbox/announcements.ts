import { hasRole, type AnnouncementDto } from '@workhub/shared';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../common/request';
import type { Tx } from '../db/db.service';
import { memberships } from '../db/schema';

interface Row extends Record<string, unknown> {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: Date | string;
  edited_at: Date | string | null;
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
  team_id: string | null;
  team_name: string | null;
  read: boolean;
  total: number;
  read_count: number;
}

/** Managers and above see every announcement and its receipts. */
export const seesAll = (ws: WorkspaceContext) => hasRole(ws.role, 'manager');

async function myTeam(tx: Tx, workspaceId: string, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ teamId: memberships.teamId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  return m?.teamId ?? null;
}

/** Announcements for everyone, for your team, or that you wrote (all of them for managers). */
async function visible(tx: Tx, ws: WorkspaceContext, userId: string): Promise<SQL> {
  if (seesAll(ws)) return sql`true`;
  const team = await myTeam(tx, ws.id, userId);
  return sql`(a.team_id is null or a.author_id = ${userId}::uuid ${team ? sql`or a.team_id = ${team}::uuid` : sql``})`;
}

/** Who an announcement is for: staff (in its team, if it has one), not counting its author. */
const audience = sql`
  mm.workspace_id = a.workspace_id and mm.role <> 'guest'
  and (a.team_id is null or mm.team_id = a.team_id)
  and mm.user_id is distinct from a.author_id`;

export async function announcementDtos(tx: Tx, ws: WorkspaceContext, userId: string, only?: string): Promise<AnnouncementDto[]> {
  const { rows } = await tx.execute<Row>(sql`
    select a.id, a.title, a.body, a.pinned, a.created_at, a.edited_at,
      a.author_id, u.name as author_name, u.email as author_email,
      a.team_id, t.name as team_name,
      exists (select 1 from announcement_reads r where r.announcement_id = a.id and r.user_id = ${userId}::uuid)
        -- Not addressed to you (your own, or another team's that a manager can see): nothing to read.
        or not exists (select 1 from memberships mm where ${audience} and mm.user_id = ${userId}::uuid) as read,
      (select count(*)::int from memberships mm where ${audience}) as total,
      (select count(*)::int from announcement_reads r join memberships mm on mm.user_id = r.user_id
        where r.announcement_id = a.id and ${audience}) as read_count
    from announcements a
    left join users u on u.id = a.author_id
    left join teams t on t.id = a.team_id
    where a.workspace_id = ${ws.id}::uuid and ${await visible(tx, ws, userId)} ${only ? sql`and a.id = ${only}::uuid` : sql``}
    order by a.pinned desc, a.created_at desc
    limit 100
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    author: r.author_id && r.author_name ? { id: r.author_id, name: r.author_name, email: r.author_email ?? '' } : null,
    team: r.team_id && r.team_name ? { id: r.team_id, name: r.team_name } : null,
    pinned: r.pinned,
    createdAt: new Date(r.created_at).toISOString(),
    editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null,
    read: r.read,
    receipts: seesAll(ws) || r.author_id === userId ? { read: r.read_count, total: r.total } : null,
  }));
}

/** Announcements addressed to you that you haven't read. */
export async function unreadAnnouncements(tx: Tx, ws: WorkspaceContext, userId: string): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from announcements a
    join memberships mm on ${audience} and mm.user_id = ${userId}::uuid
    where a.workspace_id = ${ws.id}::uuid
      and not exists (select 1 from announcement_reads r where r.announcement_id = a.id and r.user_id = ${userId}::uuid)
  `);
  return rows[0]?.n ?? 0;
}

/** The people an announcement is for, as user ids. */
export async function audienceOf(tx: Tx, workspaceId: string, announcementId: string): Promise<string[]> {
  const { rows } = await tx.execute<{ user_id: string }>(sql`
    select mm.user_id from announcements a join memberships mm on ${audience}
    where a.id = ${announcementId}::uuid and a.workspace_id = ${workspaceId}::uuid
  `);
  return rows.map((r) => r.user_id);
}
