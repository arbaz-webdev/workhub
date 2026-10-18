import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Load apps/api/.env when present (works from both src/ and dist/).
const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile) && !process.env.JEST_WORKER_ID) process.loadEnvFile(envFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see apps/api/.env.example)`);
  return value;
}

export const config = {
  get port() {
    return Number(process.env.PORT ?? 4000);
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
  get webOrigins() {
    return (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  },
  get databaseAppUrl() {
    return required('DATABASE_APP_URL');
  },
  sessionTtlDays: 30,
};
