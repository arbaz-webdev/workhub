'use client';

import { hasRole } from '@workhub/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages/en';
import { useWorkspace } from '@/lib/workspace';

const TABS = [
  { href: '/app/attendance', label: 'att.tab.mine', minRole: 'member' },
  { href: '/app/attendance/team', label: 'att.tab.team', minRole: 'manager' },
  { href: '/app/attendance/payroll', label: 'att.tab.payroll', minRole: 'manager' },
  { href: '/app/attendance/settings', label: 'att.tab.settings', minRole: 'admin' },
] as const satisfies readonly { href: string; label: MessageKey; minRole: string }[];

export function AttendanceTabs() {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const t = useT();
  const tabs = TABS.filter((tab) => hasRole(workspace.role, tab.minRole));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Attendance" className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
      {tabs.map((tab) => {
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
