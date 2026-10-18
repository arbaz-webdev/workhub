import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { TEST_ADMIN_URL, TEST_APP_URL } from './db-urls';

/** Migrates the test database and empties it before the test run. */
export default async function globalSetup() {
  execFileSync(process.execPath, [join(__dirname, '..', 'scripts', 'migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: TEST_ADMIN_URL, DATABASE_APP_URL: TEST_APP_URL },
    stdio: 'inherit',
  });

  const client = new Client({ connectionString: TEST_ADMIN_URL });
  await client.connect();
  try {
    await client.query('truncate users, workspaces, waitlist cascade');
  } finally {
    await client.end();
  }
}
