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

describe('Row-Level Security: invitations and notifications', () => {
  const colleague = randomUUID();

  beforeAll(async () => {
    await withAdmin(async (admin) => {
      await admin.query(`insert into users (id, email, name, password_hash) values ($1, $2, 'Colleague', 'x')`, [
        colleague,
        `rls-${colleague}@example.com`,
      ]);
      await admin.query(
        `insert into invitations (workspace_id, kind, email, role, token_hash, expires_at)
         values ($1, 'email', 'a@example.com', 'member', $3, now() + interval '1 day'),
                ($2, 'email', 'b@example.com', 'member', $4, now() + interval '1 day')`,
        [workspaceA, workspaceB, `hash-a-${workspaceA}`, `hash-b-${workspaceB}`],
      );
      await admin.query(
        `insert into notifications (workspace_id, user_id, type, title)
         values ($1, $2, 'test', 'mine'), ($1, $3, 'test', 'theirs')`,
        [workspaceA, userA, colleague],
      );
    });
  });

  it('shows only the current workspace’s invitations', async () => {
    const emails = await inContext({ workspaceId: workspaceA }, async () => {
      const { rows } = await app.query('select email from invitations');
      return rows.map((r) => r.email);
    });
    expect(emails).toEqual(['a@example.com']);
  });

  it('shows each person only their own notifications', async () => {
    const titles = await inContext({ workspaceId: workspaceA, userId: userA }, async () => {
      const { rows } = await app.query('select title from notifications');
      return rows.map((r) => r.title);
    });
    expect(titles).toEqual(['mine']);
  });

  it("can't mark a colleague's notification as read", async () => {
    const changed = await inContext({ workspaceId: workspaceA, userId: userA }, async () => {
      const res = await app.query('update notifications set read_at = now() where user_id = $1', [colleague]);
      return res.rowCount;
    });
    expect(changed).toBe(0);
  });

  it('can notify a colleague in the same workspace but not someone in another', async () => {
    await inContext({ workspaceId: workspaceA, userId: userA }, () =>
      app.query(`insert into notifications (workspace_id, user_id, type, title) values ($1, $2, 'test', 'hi')`, [
        workspaceA,
        colleague,
      ]),
    );
    await expect(
      inContext({ workspaceId: workspaceA, userId: userA }, () =>
        app.query(`insert into notifications (workspace_id, user_id, type, title) values ($1, $2, 'test', 'hi')`, [
          workspaceB,
          colleague,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('resolves a valid invitation token without any workspace context, and nothing else', async () => {
    const rows = await inContext({}, async () => {
      const valid = await app.query('select workspace_id, email from invitation_by_token($1)', [`hash-a-${workspaceA}`]);
      const bogus = await app.query('select * from invitation_by_token($1)', ['nope']);
      return { valid: valid.rows, bogus: bogus.rows };
    });
    expect(rows).toEqual({ valid: [{ workspace_id: workspaceA, email: 'a@example.com' }], bogus: [] });
  });
});
