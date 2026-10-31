'use client';

import { hasRole } from '@workhub/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/lib/workspace';

const TABS = [
  { href: '/app/attendance', label: 'My attendance', minRole: 'member' },
  { href: '/app/attendance/team', label: 'Team', minRole: 'manager' },
  { href: '/app/attendance/payroll', label: 'Payroll and devices', minRole: 'manager' },
  { href: '/app/attendance/settings', label: 'Shifts and offices', minRole: 'admin' },
] as const;

export function AttendanceTabs() {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const tabs = TABS.filter((t) => hasRole(workspace.role, t.minRole));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Attendance" className="mb-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-sm [scrollbar-width:none]">
      {tabs.map((t) => {
        const active = pathname === t.href;
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
