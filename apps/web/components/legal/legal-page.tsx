import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleBody } from '@/components/help/article-body';
import { SiteFooter, SiteHeader } from '@/components/landing/site';
import { LEGAL_DRAFT, legalDocument, type LegalDocument } from '@/lib/legal';

export function legalMetadata(slug: LegalDocument['slug']): Metadata {
  const doc = legalDocument(slug);
  // Drafts stay out of search results until the lawyer signs them off.
  return { title: `${doc.title} · WorkHub`, description: doc.summary, robots: LEGAL_DRAFT ? { index: false, follow: false } : undefined };
}

/** /terms and /privacy: a legal document on the public site. */
export function LegalPage({ slug }: { slug: LegalDocument['slug'] }) {
  const doc = legalDocument(slug);
  const other = legalDocument(slug === 'terms' ? 'privacy' : 'terms');
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        {LEGAL_DRAFT && (
          <p role="note" className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Draft.</strong> This document hasn’t been reviewed by a lawyer yet and isn’t in effect. The final version will replace it.
          </p>
        )}
        <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
        <p className="mt-2 text-lg text-gray-600">{doc.summary}</p>
        {doc.effectiveDate && <p className="mt-1 text-sm text-gray-500">In effect from {doc.effectiveDate}.</p>}
        <article className="mt-8">
          <ArticleBody body={doc.body} />
        </article>
        <p className="mt-12 border-t border-gray-100 pt-6 text-sm text-gray-600">
          See also the{' '}
          <Link href={`/${other.slug}`} className="text-brand-700 underline">
            {other.title}
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
