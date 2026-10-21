'use client';

import { hasRole } from '@workhub/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/lib/workspace';

const TABS = [
  { href: '/app/attendance', label: 'My attendance', minRole: 'member' },
  { href: '/app/attendance/team', label: 'Team', minRole: 'manager' },
  { href: '/app/attendance/settings', label: 'Shifts and offices', minRole: 'admin' },
] as const;

export function AttendanceTabs() {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const tabs = TABS.filter((t) => hasRole(workspace.role, t.minRole));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Attendance" className="mb-6 flex gap-1 border-b border-gray-200">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${active ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
