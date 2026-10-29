'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app/settings', label: 'Workspace' },
  { href: '/app/settings/billing', label: 'Plan and billing' },
  { href: '/app/settings/api', label: 'API' },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
      {TABS.map((t) => {
        const active = t.href === '/app/settings' ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${active ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** PKR 6,990, or with paisa when there are any: PKR 6,235.20. */
export const pkr = (n: number) => `PKR ${n.toLocaleString('en', Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
