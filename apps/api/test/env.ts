import { join } from 'node:path';
import { TEST_ADMIN_URL, TEST_APP_URL } from './db-urls';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_ADMIN_URL;
process.env.DATABASE_APP_URL = TEST_APP_URL;
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = join(__dirname, '..', '..', '..', '.data', 'test-uploads');
// Rate limits and live updates stay in memory unless a test sets it.
delete process.env.REDIS_URL;
// Billing tests expect list prices; test/sprint13.spec.ts switches the founding offer on.
process.env.FOUNDING_OFFER_ENDS = '2000-01-01';
// A small public API limit, so test/public-api.spec.ts can reach it.
process.env.API_RATE_LIMIT_PER_MINUTE = '20';
