'use client';

import { hasRole } from '@workhub/shared';
import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useInbox } from '@/lib/inbox';
import { useWorkspace } from '@/lib/workspace';
import { NAV, SOON, type NavItem } from './nav';

/** WorkHub's mark: a black tile with a lime W. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-[30%] bg-ink text-[15px] font-semibold tracking-tight text-lime">
      W
    </span>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const { summary } = useInbox();
  const items: NavItem[] = [
    ...(workspace.clientCompanyId ? [{ href: '/app/portal', label: 'Client portal', icon: Building2 }] : []),
    ...NAV.filter((i) => !i.minRole || hasRole(workspace.role, i.minRole)),
  ];
  const counts = { inbox: summary.unread, announcements: summary.announcements };

  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-0.5 p-3">
      <Link href="/app" onClick={onNavigate} className="mb-5 flex items-center gap-2.5 rounded-full px-2 py-1.5 text-[17px] font-medium tracking-tight">
        <Logo />
        WorkHub
      </Link>
      {items.map((item) => {
        const active = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
        const count = item.badge ? counts[item.badge] : 0;
        // Mentions make the inbox badge red; plain unread stays calm.
        const urgent = item.badge === 'inbox' ? summary.mentions > 0 : count > 0;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`group flex items-center gap-3 rounded-full px-3 py-2 text-sm transition-colors duration-200 ${
              active ? 'bg-ink font-medium text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 hover:text-ink'
            }`}
          >
            {Icon && (
              <Icon
                aria-hidden="true"
                size={18}
                strokeWidth={1.75}
                className={`shrink-0 transition-transform duration-200 group-hover:scale-110 ${active ? 'text-lime' : 'text-gray-500 group-hover:text-ink'}`}
              />
            )}
            <span className="flex-1">{item.label}</span>
            {count > 0 && (
              <span
                className={`min-w-5 animate-pop rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 ${
                  urgent ? 'bg-red-500 text-white' : active ? 'bg-lime text-ink' : 'bg-gray-200 text-gray-700'
                }`}
              >
                {count > 99 ? '99+' : count}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </Link>
        );
      })}
      {SOON.length > 0 && <p className="mt-6 px-3 text-xs font-medium uppercase tracking-wide text-gray-400">Coming soon</p>}
      {SOON.map((item) => (
        <span key={item.label} className="flex items-center justify-between rounded-full px-3 py-2 text-sm text-gray-400">
          {item.label}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Soon</span>
        </span>
      ))}
    </nav>
  );
}
