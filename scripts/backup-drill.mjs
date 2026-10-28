// Backup-restore drill (issue #73). Proves a restored copy of the database is complete and
// still safe to run: the same migrations, every table with its rows, and Row-Level Security
// still on. See docs/BACKUP-DRILL.md for the whole drill with Neon's point-in-time restore.
//
//   node scripts/backup-drill.mjs snapshot --db <live admin URL> --out drill.json
//     Notes the time and what the database holds. Restore to this time afterwards.
//   node scripts/backup-drill.mjs verify --db <restored admin URL> --snapshot drill.json
//     Checks the restored copy against the snapshot. Exits 1 if anything is missing.
//
// Both only read. Connection strings carry passwords: pass them from the environment
// (e.g. --db "$LIVE_URL"), not typed into a shared terminal history.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { positionals, values: opts } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: 'string' },
    out: { type: 'string', default: 'backup-drill.json' },
    snapshot: { type: 'string', default: 'backup-drill.json' },
  },
});
const command = positionals[0];
if (!['snapshot', 'verify'].includes(command ?? '') || !opts.db) {
  console.error('Usage: backup-drill.mjs snapshot --db URL [--out FILE] | verify --db URL [--snapshot FILE]');
  process.exit(2);
}

/** What the database holds now: migrations, tables with their row counts and RLS, roles. */
async function inspect(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('begin transaction isolation level repeatable read read only');
    const { rows: [{ now }] } = await client.query('select now()');
    const migrations = (await client.query('select name from schema_migrations order by name')).rows.map((r) => r.name);
    const { rows: tables } = await client.query(`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by c.relname`);
    for (const t of tables) {
      t.rows = Number((await client.query(`select count(*) from "${t.name}"`)).rows[0].count);
    }
    const roles = (await client.query(`select rolname from pg_roles where rolname = 'workhub_app'`)).rows.map((r) => r.rolname);
    await client.query('commit');
    return { at: new Date(now).toISOString(), migrations, tables, roles };
  } finally {
    await client.end();
  }
}

if (command === 'snapshot') {
  const snap = await inspect(opts.db);
  writeFileSync(opts.out, JSON.stringify(snap, null, 2));
  const rows = snap.tables.reduce((t, x) => t + x.rows, 0);
  console.log(`Snapshot at ${snap.at}: ${snap.migrations.length} migrations, ${snap.tables.length} tables, ${rows} rows → ${opts.out}`);
  console.log(`Now restore the database to ${snap.at} (or a moment after), then run verify against the restored copy.`);
  process.exit(0);
}

const snap = JSON.parse(readFileSync(opts.snapshot, 'utf8'));
const restored = await inspect(opts.db);
const problems = [];
const notes = [];

const missingMigrations = snap.migrations.filter((m) => !restored.migrations.includes(m));
if (missingMigrations.length) problems.push(`Migrations missing: ${missingMigrations.join(', ')}`);
if (!restored.roles.includes('workhub_app')) problems.push('The app role workhub_app is missing (the site migrates it on start, but check)');

const byName = new Map(restored.tables.map((t) => [t.name, t]));
for (const t of snap.tables) {
  const r = byName.get(t.name);
  if (!r) {
    problems.push(`Table ${t.name} is missing`);
    continue;
  }
  if (t.rls && !(r.rls && r.forced === t.forced)) problems.push(`Row-Level Security is off on ${t.name}`);
  // Rows written after the snapshot may be there if the restore point was a little later.
  if (r.rows < t.rows) problems.push(`${t.name}: ${t.rows - r.rows} of ${t.rows} rows missing`);
  else if (r.rows > t.rows) notes.push(`${t.name}: ${r.rows - t.rows} more rows than the snapshot (written after it)`);
}

const rows = restored.tables.reduce((t, x) => t + x.rows, 0);
console.log(`Restored copy: ${restored.migrations.length} migrations, ${restored.tables.length} tables, ${rows} rows`);
for (const n of notes) console.log(`  note: ${n}`);
if (problems.length) {
  console.log(`\nFAIL: ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`\nPASS: everything in the snapshot from ${snap.at} is in the restored copy, with Row-Level Security on.`);
