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
  sessionTtlDays: 30,
};
