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
    <nav aria-label="Settings" className="mb-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-sm [scrollbar-width:none]">
      {TABS.map((t) => {
        const active = t.href === '/app/settings' ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors duration-200 ${active ? 'bg-ink font-medium text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-ink'}`}
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
