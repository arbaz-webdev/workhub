'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HELP_ARTICLES, HELP_CATEGORIES } from '@/lib/help';

/** The article list by category, filtered as you type. */
export function HelpSearch() {
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = HELP_ARTICLES.filter((a) => {
    const text = `${a.title} ${a.summary} ${a.keywords} ${a.body}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search, e.g. night shift, invoice, recovery code"
        aria-label="Search the help centre"
        className="mt-6 w-full rounded-full border-0 bg-white px-6 py-4 text-base shadow-sm outline-none transition placeholder:text-gray-400 focus:ring-4 focus:ring-lime/40"
      />
      <div className="mt-8 space-y-10" aria-live="polite">
        {matches.length === 0 && <p className="text-sm text-gray-500">Nothing matches “{query}”. Try another word.</p>}
        {HELP_CATEGORIES.map((category) => {
          const inCategory = matches.filter((a) => a.category === category);
          if (inCategory.length === 0) return null;
          return (
            <section key={category}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{category}</h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {inCategory.map((a) => (
                  <li key={a.slug}>
                    <Link href={`/help/${a.slug}`} className="lift block h-full rounded-3xl bg-white p-5 shadow-sm">
                      <span className="font-medium text-ink">{a.title}</span>
                      <span className="mt-1 block text-sm text-gray-600">{a.summary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
