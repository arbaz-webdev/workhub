'use client';

import { LOCALE_NAMES, LOCALES, type Locale } from '@workhub/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { storeLocale, useLocale, useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace';

/** The person's language, saved to their account so every device uses it. */
export function LanguageCard() {
  const t = useT();
  const locale = useLocale();
  const { refresh } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function choose(next: Locale) {
    if (next === locale) return;
    setBusy(true);
    setError(false);
    try {
      await api('/auth/me/locale', { method: 'PATCH', body: { locale: next } });
      storeLocale(next);
      await refresh();
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('language.title')} description={t('language.help')}>
      {error && (
        <div className="mb-3">
          <Alert>{t('language.failed')}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('language.title')}>
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={locale === l}
            lang={l}
            disabled={busy}
            onClick={() => void choose(l)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${locale === l ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {LOCALE_NAMES[l]}
          </button>
        ))}
      </div>
      {locale !== 'en' && <p className="mt-3 text-xs text-gray-500">{t('language.partial')}</p>}
    </Card>
  );
}
