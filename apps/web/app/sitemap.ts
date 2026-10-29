import type { MetadataRoute } from 'next';
import { HELP_ARTICLES } from '@/lib/help';
import { siteUrl } from '@/lib/site-url';

/** The public pages, for search engines. The app itself (/app) is behind sign-in. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/pricing`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/help`, changeFrequency: 'weekly', priority: 0.7 },
    ...HELP_ARTICLES.map((a) => ({ url: `${base}/help/${a.slug}`, changeFrequency: 'monthly' as const, priority: 0.6 })),
    { url: `${base}/status`, changeFrequency: 'always', priority: 0.3 },
  ];
}
