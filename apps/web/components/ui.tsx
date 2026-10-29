import type { Locale, Role } from '@workhub/shared';
import { intlLocale, translate } from '@/lib/i18n';

export const btn = {
  primary:
    'inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60',
  secondary:
    'inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60',
  ghost: 'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100',
  danger: 'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50',
};

export const input =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      <div className={title || description ? 'mt-4' : ''}>{children}</div>
    </section>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success'; children: React.ReactNode }) {
  const cls = kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700';
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${cls}`}>
      {children}
    </p>
  );
}

export function roleLabel(role: Role, locale: Locale = 'en') {
  return translate(locale, `role.${role}`);
}

const formatters = new Map<Locale, Intl.RelativeTimeFormat>();
export function timeAgo(iso: string, locale: Locale = 'en'): string {
  let rtf = formatters.get(locale);
  if (!rtf) formatters.set(locale, (rtf = new Intl.RelativeTimeFormat(locale === 'en' ? 'en' : intlLocale(locale), { numeric: 'auto' })));
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return translate(locale, 'time.justNow');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day');
  return new Date(iso).toLocaleDateString(locale === 'en' ? undefined : intlLocale(locale));
}
