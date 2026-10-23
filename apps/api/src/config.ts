import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Load apps/api/.env when present (works from both src/ and dist/).
const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile) && !process.env.JEST_WORKER_ID) process.loadEnvFile(envFile);

/**
 * The restricted connection the API uses. Either given in full (DATABASE_APP_URL), or
 * built from the admin URL with the app user and APP_DB_PASSWORD, for hosts that can
 * only hand over one database URL. scripts/migrate.mjs builds it the same way.
 */
export function appDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_APP_URL) return env.DATABASE_APP_URL;
  if (env.DATABASE_URL && env.APP_DB_PASSWORD) {
    const url = new URL(env.DATABASE_URL);
    url.username = env.DATABASE_APP_USER ?? 'workhub_app';
    url.password = env.APP_DB_PASSWORD;
    return url.toString();
  }
  throw new Error('Set DATABASE_APP_URL, or DATABASE_URL and APP_DB_PASSWORD (see apps/api/.env.example)');
}

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
  /** Express "trust proxy": a hop count ("2") or a preset ("loopback"). */
  get trustProxy(): number | string {
    const value = process.env.TRUST_PROXY ?? 'loopback';
    if (/^\d+$/.test(value)) return Number(value);
    if (!/^(loopback|linklocal|uniquelocal)(,\s*(loopback|linklocal|uniquelocal))*$/.test(value)) {
      throw new Error(`TRUST_PROXY must be a number of proxies or loopback/linklocal/uniquelocal, not ${value}`);
    }
    return value;
  },
  get databaseAppUrl() {
    return appDatabaseUrl();
  },
  /** Public URL of the web app, used in email links and OAuth redirects. */
  get appUrl() {
    return (process.env.APP_URL ?? config.webOrigins[0] ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  /** 'console' prints emails (development/tests); 'resend' sends them for real. */
  get emailTransport(): 'console' | 'resend' {
    const value = process.env.EMAIL_TRANSPORT ?? 'console';
    if (value !== 'console' && value !== 'resend') throw new Error(`Unknown EMAIL_TRANSPORT ${value}`);
    return value;
  },
  /** Lets a staging site run with EMAIL_TRANSPORT=console (emails in the log). Never in real production. */
  get allowConsoleEmail() {
    return process.env.ALLOW_CONSOLE_EMAIL === 'true';
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? 'WorkHub <no-reply@localhost>';
  },
  get resendApiKey() {
    return required('RESEND_API_KEY');
  },
  /** Google sign-in is switched on only when both values are set. */
  get google(): { clientId: string; clientSecret: string } | null {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  },
  /** File storage: "local" disk for development, "s3" for AWS S3 or Cloudflare R2. */
  get storage() {
    const driver = (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3';
    if (driver !== 'local' && driver !== 's3') throw new Error(`Unknown STORAGE_DRIVER ${driver}`);
    return {
      driver,
      localDir: process.env.LOCAL_STORAGE_DIR ?? join(__dirname, '..', '..', '..', '.data', 'uploads'),
      bucket: driver === 's3' ? required('S3_BUCKET') : '',
      region: process.env.S3_REGION ?? 'auto',
      endpoint: process.env.S3_ENDPOINT ?? '',
      accessKeyId: driver === 's3' ? required('S3_ACCESS_KEY_ID') : '',
      secretAccessKey: driver === 's3' ? required('S3_SECRET_ACCESS_KEY') : '',
    };
  },
  maxUploadBytes: 25 * 1024 * 1024,
  sessionTtlDays: 30,
};
