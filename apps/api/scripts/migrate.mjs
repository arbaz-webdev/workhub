// Applies SQL migrations in order, then makes sure the restricted app role exists
// and has exactly the privileges the API needs.
//
//   DATABASE_URL      admin connection used to run migrations (owns the tables)
//   DATABASE_APP_URL  connection the API uses; its user is created/updated here.
//                     It does not own the tables and has no BYPASSRLS, so
//                     Row-Level Security always applies to it.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '.env');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;
if (!adminUrl || !appUrl) {
  console.error('DATABASE_URL and DATABASE_APP_URL must be set (see apps/api/.env.example).');
  process.exit(1);
}

const appUser = decodeURIComponent(new URL(appUrl).username);
const appPassword = decodeURIComponent(new URL(appUrl).password);
if (!/^[a-z_][a-z0-9_]*$/.test(appUser)) {
  console.error(`Invalid app database user name: ${appUser}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();

try {
  // Names, task titles and file names come in every script (Urdu, Arabic, emoji), so the
  // database must store UTF-8. Windows installs default to WIN1252, which can't.
  const { rows: enc } = await client.query('select pg_encoding_to_char(encoding) as enc from pg_database where datname = current_database()');
  if (enc[0].enc !== 'UTF8') {
    throw new Error(`database encoding is ${enc[0].enc}; WorkHub needs UTF8. For the local dev database run: npm run db:fix-encoding`);
  }

  await client.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);

  const dir = join(here, '..', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query('select name from schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`${file} failed: ${err.message}`);
    }
  }

  const { rowCount } = await client.query('select 1 from pg_roles where rolname = $1', [appUser]);
  const verb = rowCount ? 'alter' : 'create';
  await client.query(
    `${verb} role ${appUser} with login nosuperuser nobypassrls nocreatedb nocreaterole password ${client.escapeLiteral(appPassword)}`,
  );

  const { rows: db } = await client.query('select current_database() as name');
  await client.query(`grant connect on database ${client.escapeIdentifier(db[0].name)} to ${appUser}`);
  await client.query(`grant usage on schema public to ${appUser}`);
  await client.query(`grant select, insert, update, delete on all tables in schema public to ${appUser}`);
  await client.query(`grant usage, select on all sequences in schema public to ${appUser}`);
  await client.query(`grant execute on all functions in schema public to ${appUser}`);
  await client.query(`revoke all on schema_migrations from ${appUser}`);

  console.log(`migrations up to date; app role "${appUser}" ready`);
} finally {
  await client.end();
}
