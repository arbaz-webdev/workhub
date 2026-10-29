'use client';

import { LOCALE_NAMES, LOCALES } from '@workhub/shared';
import { useRouter } from 'next/navigation';
import { storeLocale, useLocale } from '@/lib/i18n';

/** On the sign-in and sign-up pages: the other language, before anyone has an account. */
export function LanguageSwitch() {
  const locale = useLocale();
  const router = useRouter();
  const other = LOCALES.find((l) => l !== locale)!;
  return (
    <span className="mt-3 block">
      <button
        type="button"
        lang={other}
        className="text-sm font-medium text-gray-600 hover:text-gray-900 hover:underline"
        onClick={() => {
          storeLocale(other);
          router.refresh();
        }}
      >
        {LOCALE_NAMES[other]}
      </button>
    </span>
  );
}
