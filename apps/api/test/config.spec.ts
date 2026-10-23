import { appDatabaseUrl } from '../src/config';

describe('the app database connection', () => {
  it('uses DATABASE_APP_URL when given', () => {
    expect(appDatabaseUrl({ DATABASE_APP_URL: 'postgres://a:b@h/db', DATABASE_URL: 'postgres://x:y@h/db', APP_DB_PASSWORD: 'p' })).toBe(
      'postgres://a:b@h/db',
    );
  });

  it('builds it from the admin URL and a generated password, keeping SSL settings', () => {
    const url = appDatabaseUrl({
      DATABASE_URL: 'postgresql://neondb_owner:secret@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
      APP_DB_PASSWORD: 'a+b/c=d==',
    });
    const parsed = new URL(url);
    expect(parsed.username).toBe('workhub_app');
    expect(decodeURIComponent(parsed.password)).toBe('a+b/c=d==');
    expect(parsed.hostname).toBe('ep-x.ap-southeast-1.aws.neon.tech');
    expect(parsed.pathname).toBe('/neondb');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
  });

  it('says what is missing', () => {
    expect(() => appDatabaseUrl({ DATABASE_URL: 'postgres://x:y@h/db' })).toThrow(/APP_DB_PASSWORD/);
  });
});
