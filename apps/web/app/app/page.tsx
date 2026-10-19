'use client';

import { hasRole } from '@workhub/shared';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';

const STEPS = [
  { href: '/app/people#invite', title: 'Invite your team', body: 'Send email invites or share a join link.', minRole: 'admin' as const },
  { href: '/app/teams', title: 'Create teams', body: 'Group people by department, e.g. Design, Sales, Support.', minRole: 'manager' as const },
  { href: '/app/settings', title: 'Check your settings', body: 'Time zone, currency and working days.', minRole: 'admin' as const },
];

export default function Home() {
  const { me, workspace } = useWorkspace();
  const steps = STEPS.filter((s) => hasRole(workspace.role, s.minRole));

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.user.name.split(' ')[0]}`}
        description={`This is ${workspace.name}. Attendance, project boards, CRM and chat arrive over the next sprints.`}
      />
      {steps.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-500"
            >
              <p className="font-semibold">{s.title}</p>
              <p className="mt-1 text-sm text-gray-500">{s.body}</p>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-8 text-sm text-gray-500">
        Tip: press <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 text-xs">Ctrl K</kbd> anywhere to jump
        to a page or person.
      </p>
    </>
  );
}
