// One-off: rebuilds local dev databases created with a non-UTF-8 encoding (Windows
// defaults to WIN1252), keeping their data. Needs the dev database running (npm run db:start).
// The old database is kept as <name>_old until you drop it.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const url = (db) => `postgres://postgres:postgres@localhost:${port}/${db}`;
const root = process.cwd();
const envFile = join(root, 'apps', 'api', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const withDb = (base, db) => Object.assign(new URL(base), { pathname: `/${db}` }).toString();

const admin = new pg.Client({ connectionString: url('postgres') });
await admin.connect();
const { rows } = await admin.query(
  `select datname from pg_database where datname in ('workhub', 'workhub_test') and pg_encoding_to_char(encoding) <> 'UTF8'`,
);
if (rows.length === 0) {
  console.log('All WorkHub databases are already UTF-8.');
  process.exit(0);
}

for (const { datname: name } of rows) {
  const old = `${name}_old`;
  console.log(`Rebuilding ${name} as UTF-8 (old copy kept as ${old}) ...`);
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [name]);
  await admin.query(`drop database if exists ${old}`);
  await admin.query(`alter database ${name} rename to ${old}`);
  await admin.query(`create database ${name} encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);

  // Same schema, via the normal migrations.
  execFileSync(process.execPath, [join(root, 'apps', 'api', 'scripts', 'migrate.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url(name), DATABASE_APP_URL: withDb(process.env.DATABASE_APP_URL, name) },
  });

  // Copy every table as JSON, which keeps exact timestamps, arrays and jsonb.
  const from = new pg.Client({ connectionString: url(old) });
  const to = new pg.Client({ connectionString: url(name) });
  await from.connect();
  await to.connect();
  await to.query('begin');
  await to.query(`set session_replication_role = replica`); // skip FK order and triggers while copying
  const tables = await to.query(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' order by tablename`,
  );
  for (const { tablename } of tables.rows) {
    const cols = await to.query(
      `select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped and attgenerated = ''`,
      [tablename],
    );
    const list = cols.rows.map((c) => `"${c.attname}"`).join(', ');
    const data = await from.query(`select coalesce(json_agg(t), '[]')::text as j from (select ${list} from "${tablename}") t`);
    await to.query(`insert into "${tablename}" (${list}) select ${list} from json_populate_recordset(null::"${tablename}", $1::json)`, [data.rows[0].j]);
    const n = JSON.parse(data.rows[0].j).length;
    if (n) console.log(`  ${tablename}: ${n} rows`);
  }
  await to.query('commit');
  await from.end();
  await to.end();
}
await admin.end();
console.log('Done. Once you are happy, drop the *_old databases.');
