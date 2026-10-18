// Database-level proof that Row-Level Security isolates workspaces, independent of API code.
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { TEST_APP_URL } from './db-urls';
import { withAdmin } from './helpers';

const workspaceA = randomUUID();
const workspaceB = randomUUID();
const userA = randomUUID();

let app: Client;

async function inContext<T>(ctx: { workspaceId?: string; userId?: string }, fn: () => Promise<T>): Promise<T> {
  await app.query('begin');
  try {
    await app.query(`select set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)`, [
      ctx.workspaceId ?? '',
      ctx.userId ?? '',
    ]);
    return await fn();
  } finally {
    await app.query('rollback');
  }
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`insert into users (id, email, name, password_hash) values ($1, $2, 'A', 'x')`, [
      userA,
      `rls-${userA}@example.com`,
    ]);
    await admin.query(`insert into workspaces (id, name, slug) values ($1, 'A', $3), ($2, 'B', $4)`, [
      workspaceA,
      workspaceB,
      `a-${workspaceA}`,
      `b-${workspaceB}`,
    ]);
    await admin.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')`, [
      workspaceA,
      userA,
    ]);
    await admin.query(`insert into teams (workspace_id, name) values ($1, 'Team A'), ($2, 'Team B')`, [
      workspaceA,
      workspaceB,
    ]);
  });
  app = new Client({ connectionString: TEST_APP_URL });
  await app.connect();
});

afterAll(async () => {
  await app.end();
});

describe('Row-Level Security', () => {
  it('the app role is not a superuser and cannot bypass RLS', async () => {
    const { rows } = await app.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('shows only the current workspace, even without a WHERE clause', async () => {
    const names = await inContext({ workspaceId: workspaceA }, async () => {
      const { rows } = await app.query('select name from teams');
      return rows.map((r) => r.name);
    });
    expect(names).toEqual(['Team A']);
  });

  it('hides other workspaces even when asked for them directly', async () => {
    const count = await inContext({ workspaceId: workspaceA }, async () => {
      const { rows } = await app.query('select count(*)::int as n from teams where workspace_id = $1', [workspaceB]);
      return rows[0].n;
    });
    expect(count).toBe(0);
  });

  it('refuses to write rows into another workspace', async () => {
    await expect(
      inContext({ workspaceId: workspaceA }, () =>
        app.query(`insert into teams (workspace_id, name) values ($1, 'sneaky')`, [workspaceB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('refuses to move a row into another workspace', async () => {
    await expect(
      inContext({ workspaceId: workspaceA }, () => app.query('update teams set workspace_id = $1', [workspaceB])),
    ).rejects.toThrow(/row-level security/);
  });

  it('returns nothing when no workspace context is set', async () => {
    const counts = await inContext({}, async () => {
      const teams = await app.query('select count(*)::int as n from teams');
      const workspaces = await app.query('select count(*)::int as n from workspaces');
      return [teams.rows[0].n, workspaces.rows[0].n];
    });
    expect(counts).toEqual([0, 0]);
  });

  it('lets a user see only their own memberships and workspaces across tenants', async () => {
    const result = await inContext({ userId: userA }, async () => {
      const m = await app.query('select workspace_id from memberships');
      const w = await app.query('select id from workspaces');
      return { memberships: m.rows.map((r) => r.workspace_id), workspaces: w.rows.map((r) => r.id) };
    });
    expect(result).toEqual({ memberships: [workspaceA], workspaces: [workspaceA] });
  });

  it('keeps the migrations table off-limits to the app role', async () => {
    await expect(app.query('select * from schema_migrations')).rejects.toThrow(/permission denied/);
  });
});
