'use client';

import { LOCALE_COOKIE, type Locale } from '@workhub/shared';
import { createContext, useCallback, useContext } from 'react';
import { en, type MessageKey } from './messages/en';
import { ur } from './messages/ur';

// The interface's words. English is the source; a key missing from another language shows
// in English, so screens can be translated a few at a time.
const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ur };

const LocaleContext = createContext<Locale>('en');

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export type Vars = Record<string, string | number>;

/** `{name}` in a message is replaced by vars.name. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const text = DICTIONARIES[locale][key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}

export function useT() {
  const locale = useLocale();
  return useCallback((key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
}

/** For dates and numbers: Urdu month and day names, or British English. */
export function intlLocale(locale: Locale): string {
  return locale === 'ur' ? 'ur-PK' : 'en-GB';
}

/** Remembers the language in this browser; pages read it when they're rendered. */
export function storeLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${365 * 24 * 60 * 60}; samesite=lax`;
}
