import { TEST_ADMIN_URL, TEST_APP_URL } from './db-urls';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_ADMIN_URL;
process.env.DATABASE_APP_URL = TEST_APP_URL;
process.env.WEB_ORIGIN = 'http://localhost:3000';
