'use client';

import { hasRole, type TimesheetDto } from '@workhub/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/lib/workspace';
import { dayLabel, hhmm } from '@/lib/time';

const STATUS_STYLE: Record<TimesheetDto['status'], string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
};
const STATUS_TEXT: Record<TimesheetDto['status'], string> = {
  draft: 'Not submitted',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Sent back',
};

export function SheetStatus({ status }: { status: TimesheetDto['status'] }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_TEXT[status]}</span>;
}

export function TimesheetTabs() {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const tabs = [
    { href: '/app/timesheets', label: 'My timesheet' },
    ...(hasRole(workspace.role, 'manager') ? [{ href: '/app/timesheets/approvals', label: 'Approvals' }] : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Timesheets" className="mb-6 flex gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={pathname === t.href ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${pathname === t.href ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Tasks down the side, days across, hours in each cell. */
export function TimesheetGrid({ sheet }: { sheet: TimesheetDto }) {
  if (sheet.rows.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">No time logged this week. Use the timer or “Log time” on a task.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left">Task</th>
            {sheet.days.map((d) => (
              <th key={d} className="px-2 py-2 text-right">
                {dayLabel(d, { weekday: 'short', day: 'numeric' })}
              </th>
            ))}
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((r) => (
            <tr key={`${r.projectId}:${r.taskId}`} className="border-b border-gray-100">
              <td className="px-3 py-2">
                {r.taskId ? (
                  <Link href={`/app/projects/${r.projectId}?task=${r.taskId}`} className="hover:underline">
                    {r.taskTitle}
                  </Link>
                ) : (
                  r.taskTitle
                )}
                <span className="block text-xs text-gray-500">{r.projectName}</span>
              </td>
              {r.minutes.map((m, i) => (
                <td key={i} className={`px-2 py-2 text-right tabular-nums ${m ? 'text-gray-900' : 'text-gray-300'}`}>
                  {m ? hhmm(m) : '·'}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-medium tabular-nums">{hhmm(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 text-sm font-semibold">
          <tr>
            <td className="px-3 py-2">Total</td>
            {sheet.dayTotals.map((m, i) => (
              <td key={i} className="px-2 py-2 text-right tabular-nums">
                {m ? hhmm(m) : ''}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums">{hhmm(sheet.total)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
        {hhmm(sheet.billable)} billable · {hhmm(sheet.fromTimer)} from timers · {hhmm(sheet.manual)} entered by hand
      </p>
    </div>
  );
}
