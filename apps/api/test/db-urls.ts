// Tests use their own database so they never touch development data.
// CI overrides these with TEST_DATABASE_URL / TEST_DATABASE_APP_URL.
export const TEST_ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/workhub_test';
export const TEST_APP_URL =
  process.env.TEST_DATABASE_APP_URL ?? 'postgres://workhub_app:workhub_app_dev@localhost:5433/workhub_test';
