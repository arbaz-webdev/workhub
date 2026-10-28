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
