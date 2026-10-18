// Runs a real PostgreSQL server for local development without Docker.
// Data lives in .data/pg (git-ignored). Stop with Ctrl+C.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const databaseDir = join(process.cwd(), '.data', 'pg');
const databases = ['workhub', 'workhub_test'];

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: () => {},
});

if (!existsSync(join(databaseDir, 'PG_VERSION'))) {
  console.log('Initialising a new local database in .data/pg ...');
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
for (const name of databases) {
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (!rowCount) {
    await client.query(`create database ${name}`);
    console.log(`Created database ${name}`);
  }
}
await client.end();

console.log(`PostgreSQL is running on localhost:${port} (databases: ${databases.join(', ')}). Press Ctrl+C to stop.`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
