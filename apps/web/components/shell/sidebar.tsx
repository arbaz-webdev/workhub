'use client';

import { hasRole } from '@workhub/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useInbox } from '@/lib/inbox';
import { useWorkspace } from '@/lib/workspace';
import { NAV, SOON } from './nav';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const { summary } = useInbox();
  const items = NAV.filter((i) => !i.minRole || hasRole(workspace.role, i.minRole));
  const counts = { inbox: summary.unread, announcements: summary.announcements };

  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <Link href="/app" onClick={onNavigate} className="mb-4 flex items-center gap-2 px-2 py-1 text-lg font-semibold">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">W</span>
        WorkHub
      </Link>
      {items.map((item) => {
        const active = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
        const count = item.badge ? counts[item.badge] : 0;
        // Mentions make the inbox badge red; plain unread stays calm.
        const urgent = item.badge === 'inbox' ? summary.mentions > 0 : count > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${
              active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {item.label}
            {count > 0 && (
              <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 ${urgent ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700'}`}>
                {count > 99 ? '99+' : count}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </Link>
        );
      })}
      {SOON.length > 0 && <p className="mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Coming soon</p>}
      {SOON.map((item) => (
        <span key={item.label} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-gray-400">
          {item.label}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Soon</span>
        </span>
      ))}
    </nav>
  );
}
