import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody } from '@/components/help/article-body';
import { SiteFooter, SiteHeader } from '@/components/landing/site';
import { HELP_ARTICLES, helpArticle } from '@/lib/help';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = helpArticle((await params).slug);
  return article ? { title: `${article.title} · WorkHub help`, description: article.summary } : {};
}

export default async function HelpArticlePage({ params }: Props) {
  const article = helpArticle((await params).slug);
  if (!article) notFound();
  const related = HELP_ARTICLES.filter((a) => a.category === article.category && a.slug !== article.slug);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <nav aria-label="Breadcrumb" className="text-sm text-gray-500">
          <Link href="/help" className="hover:text-gray-800">
            Help centre
          </Link>{' '}
          / {article.category}
        </nav>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{article.title}</h1>
        <p className="mt-2 text-lg text-gray-600">{article.summary}</p>
        <article className="mt-8">
          <ArticleBody body={article.body} />
        </article>
        {related.length > 0 && (
          <aside className="mt-12 border-t border-gray-100 pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Also in {article.category}</h2>
            <ul className="mt-3 space-y-2">
              {related.map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="text-brand-700 underline">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
