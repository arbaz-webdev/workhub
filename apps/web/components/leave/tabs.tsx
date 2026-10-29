'use client';

import { hasRole, type Locale, type RequestStatus, type Role } from '@workhub/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { intlLocale, translate, useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages/en';
import { useWorkspace } from '@/lib/workspace';

const TABS: { href: string; label: MessageKey; minRole: Role }[] = [
  { href: '/app/leave', label: 'leave.tab.mine', minRole: 'member' },
  { href: '/app/leave/calendar', label: 'leave.tab.calendar', minRole: 'member' },
  { href: '/app/leave/approvals', label: 'leave.tab.approvals', minRole: 'manager' },
  { href: '/app/leave/settings', label: 'leave.tab.settings', minRole: 'admin' },
];

export function LeaveTabs() {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const t = useT();
  return (
    <nav aria-label={t('leave.title')} className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
      {TABS.filter((tab) => hasRole(workspace.role, tab.minRole)).map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${active ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}

export const LEAVE_COLOR: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-800',
  teal: 'bg-teal-100 text-teal-800',
  amber: 'bg-amber-100 text-amber-800',
  violet: 'bg-violet-100 text-violet-800',
  pink: 'bg-pink-100 text-pink-800',
  gray: 'bg-gray-200 text-gray-700',
};

export const REQUEST_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

export function StatusPill({ status }: { status: RequestStatus }) {
  const t = useT();
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_STYLE[status] ?? ''}`}>{t(`leave.status.${status}`)}</span>;
}

export function rangeLabel(start: string, end: string, halfDay?: string, locale: Locale = 'en') {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(locale === 'en' ? undefined : intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const half = halfDay === 'first' ? translate(locale, 'leave.firstHalf') : halfDay === 'second' ? translate(locale, 'leave.secondHalf') : '';
  return start === end ? `${fmt(start)}${half}` : `${fmt(start)} – ${fmt(end)}`;
}
