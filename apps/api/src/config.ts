import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { API_RATE_LIMIT_PER_MINUTE, LAUNCH_DATE } from '@workhub/shared';

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
  /** Interface to listen on; unset means all of them. */
  get host(): string | undefined {
    return process.env.HOST || undefined;
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
  /** Connections each API copy keeps to Postgres. Keep copies × size under the database's limit. */
  get databasePoolSize(): number {
    const value = Number(process.env.DATABASE_POOL_SIZE ?? 10);
    if (!Number.isInteger(value) || value < 1) throw new Error('DATABASE_POOL_SIZE must be a whole number of connections');
    return value;
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
  /** Product analytics; off unless POSTHOG_KEY is set (and always off in tests). */
  get posthog(): { key: string; host: string } | null {
    const key = process.env.POSTHOG_KEY;
    if (!key || process.env.JEST_WORKER_ID) return null;
    return { key, host: (process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com').replace(/\/$/, '') };
  },
  /** Where the in-app feedback button's messages are emailed; unset keeps them in the database only. */
  get feedbackTo(): string | undefined {
    return process.env.FEEDBACK_TO || undefined;
  },
  /** Public API requests each key may make per minute. */
  get apiRateLimit(): number {
    return Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? API_RATE_LIMIT_PER_MINUTE);
  },
  /** Billing and plan limits. "false" opens everything (the free beta). */
  get billingEnforced() {
    return process.env.BILLING_ENFORCED !== 'false';
  },
  /**
   * How invoices are paid online: "none", or "test" (a pretend checkout for development
   * and staging, refused in production unless ALLOW_TEST_PAYMENTS=true). Real gateways
   * (Safepay, PayFast) plug in here once a merchant account exists.
   */
  get paymentsDriver(): 'none' | 'test' {
    const value = process.env.PAYMENTS_DRIVER ?? (config.isProduction ? 'none' : 'test');
    if (value !== 'none' && value !== 'test') throw new Error(`Unknown PAYMENTS_DRIVER ${value}`);
    if (value === 'test' && config.isProduction && process.env.ALLOW_TEST_PAYMENTS !== 'true') {
      throw new Error('PAYMENTS_DRIVER=test is not allowed in production; set ALLOW_TEST_PAYMENTS=true only on a staging site.');
    }
    return value;
  },
  /** Who the invoices are from. */
  get seller() {
    return {
      name: process.env.SELLER_NAME ?? 'WorkHub',
      ntn: process.env.SELLER_NTN || null,
      address: process.env.SELLER_ADDRESS || null,
      email: process.env.SELLER_EMAIL ?? 'billing@workhub.pk',
    };
  },
  /** Bank details for paying by transfer (IBFT); off unless an IBAN is set. */
  get bankAccount(): { bank: string; accountTitle: string; iban: string } | null {
    const iban = process.env.BANK_IBAN;
    if (!iban) return null;
    return { bank: process.env.BANK_NAME ?? 'Bank', accountTitle: process.env.BANK_ACCOUNT_TITLE ?? config.seller.name, iban };
  },
  /** WorkHub staff who review bank transfers, by email (lower-case). */
  get platformAdmins(): string[] {
    return (process.env.PLATFORM_ADMINS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  /**
   * Sales tax on services by province, as JSON to override the defaults, e.g.
   * {"punjab": 16, "sindh": 15}. Confirm current rates with a tax adviser before launch.
   */
  get salesTaxRates(): Record<string, number> {
    const defaults: Record<string, number> = { punjab: 16, sindh: 15, kp: 15, balochistan: 15, islamabad: 15, gb: 0, ajk: 0, outside: 0 };
    if (!process.env.SALES_TAX_RATES) return defaults;
    return { ...defaults, ...(JSON.parse(process.env.SALES_TAX_RATES) as Record<string, number>) };
  },
  /**
   * Encrypts two-factor secrets at rest. Required in production; changing it turns off
   * everyone's two-factor sign-in (they set it up again).
   */
  get totpEncryptionKey(): string {
    const value = process.env.TOTP_ENCRYPTION_KEY;
    if (value) return value;
    if (config.isProduction) throw new Error('Missing required environment variable TOTP_ENCRYPTION_KEY (see apps/api/.env.example)');
    return 'development-only-totp-key';
  },
  /** Workspaces created before this day (YYYY-MM-DD) get the founding-customer discount for life. */
  get foundingOfferEnds(): string {
    const value = process.env.FOUNDING_OFFER_ENDS ?? LAUNCH_DATE;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('FOUNDING_OFFER_ENDS must be a date like 2027-05-03');
    return value;
  },
  /** Shares rate limits and live updates between API copies. Unset: kept in memory (one copy). */
  get redisUrl(): string | undefined {
    return process.env.REDIS_URL || undefined;
  },
  maxUploadBytes: 25 * 1024 * 1024,
  sessionTtlDays: 30,
};
