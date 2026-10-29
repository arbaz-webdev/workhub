/** The public address of the site, from the APP_URL the API also uses (no trailing slash). */
export function siteUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}
