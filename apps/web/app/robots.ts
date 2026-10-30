import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { siteUrl } from '@/lib/site-url';

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Built per request, like the sitemap: APP_URL is only known when the server runs.
  await connection();
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/app', '/api', '/invite', '/reset-password', '/verify-email'] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
