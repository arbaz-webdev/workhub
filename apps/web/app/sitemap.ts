import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { HELP_ARTICLES } from '@/lib/help';
import { LEGAL_DOCUMENTS, LEGAL_DRAFT } from '@/lib/legal';
import { siteUrl } from '@/lib/site-url';

/** The public pages, for search engines. The app itself (/app) is behind sign-in. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Built per request: APP_URL is only known when the server runs, not when the image is built.
  await connection();
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/pricing`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/help`, changeFrequency: 'weekly', priority: 0.7 },
    ...HELP_ARTICLES.map((a) => ({ url: `${base}/help/${a.slug}`, changeFrequency: 'monthly' as const, priority: 0.6 })),
    { url: `${base}/status`, changeFrequency: 'always', priority: 0.3 },
    { url: `${base}/developers`, changeFrequency: 'monthly', priority: 0.4 },
    // Listed once the lawyer has signed them off.
    ...(LEGAL_DRAFT ? [] : LEGAL_DOCUMENTS.map((d) => ({ url: `${base}/${d.slug}`, changeFrequency: 'yearly' as const, priority: 0.2 }))),
  ];
}
