'use client';

import { hasRole, type TimesheetDto, type TimesheetSummaryDto } from '@workhub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { SheetStatus, TimesheetGrid, TimesheetTabs } from '@/components/timesheets/grid';
import { Alert, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { addDays, dayLabel, hhmm, localToday, mondayOf } from '@/lib/time';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

export default function TimesheetApprovalsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
      <Approvals />
    </Suspense>
  );
}

function Approvals() {
  const { workspace, me } = useWorkspace();
  const api = useWorkspaceApi();
  const router = useRouter();
  const params = useSearchParams();
  const week = params.get('week') ?? mondayOf(localToday());
  const [list, setList] = useState<TimesheetSummaryDto[]>();
  const [open, setOpen] = useState<TimesheetDto | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<TimesheetSummaryDto[]>(`/timesheets?week=${week}`)
      .then(setList)
      .catch(() => setError('Could not load timesheets.'));
  }, [api, week]);
  useEffect(load, [load]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title="Timesheets" />
        <Alert>Only managers can approve timesheets.</Alert>
      </>
    );
  }

  const go = (w: string) => {
    setOpen(null);
    router.push(`/app/timesheets/approvals?week=${w}`, { scroll: false });
  };

  async function view(userId: string) {
    setNote('');
    setOpen(await api<TimesheetDto>(`/timesheets/people/${userId}?week=${week}`));
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!open?.id) return;
    setError(undefined);
    try {
      setOpen(await api<TimesheetDto>(`/timesheets/${open.id}/${decision}`, { method: 'POST', body: { note: note || undefined } }));
      setNotice(`${open.user.name}’s week ${decision === 'approve' ? 'approved' : 'sent back'}.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the decision.');
    }
  }

  const waiting = list?.filter((s) => s.status === 'submitted').length ?? 0;
  const mayDecide = (userId: string) => userId !== me.user.id || workspace.role === 'owner';

  return (
    <>
      <PageHeader title="Timesheets" description="Everyone’s week. Approving locks it." />
      <TimesheetTabs />
      <div className="mb-4 space-y-2" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className={btn.ghost} aria-label="Previous week" onClick={() => go(addDays(week, -7))}>
          ←
        </button>
        <span className="font-medium">Week of {dayLabel(week, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <button type="button" className={btn.ghost} aria-label="Next week" onClick={() => go(addDays(week, 7))}>
          →
        </button>
        {waiting > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{waiting} waiting</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
            <tr>
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Hours</th>
              <th className="px-3 py-2 text-right">Billable</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list?.map((s) => (
              <tr key={s.user.id} className={`border-b border-gray-100 last:border-0 ${open?.user.id === s.user.id ? 'bg-brand-50/60' : ''}`}>
                <td className="px-3 py-2 font-medium">{s.user.name}</td>
                <td className="px-3 py-2">
                  <SheetStatus status={s.status} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{hhmm(s.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{hhmm(s.billable)}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className={btn.ghost} onClick={() => view(s.user.id)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <section className="mt-6" aria-label={`${open.user.name}'s week`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{open.user.name}</h2>
            <SheetStatus status={open.status} />
            {open.status === 'submitted' &&
              (mayDecide(open.user.id) ? (
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" maxLength={500} className={`${input} !w-56 !py-1.5`} />
                  <button type="button" className={`${btn.primary} !py-1.5`} onClick={() => decide('approve')}>
                    Approve
                  </button>
                  <button type="button" className={btn.danger} onClick={() => decide('reject')}>
                    Send back
                  </button>
                </span>
              ) : (
                <span className="ml-auto text-xs text-gray-500">Your own: someone else approves it</span>
              ))}
          </div>
          <TimesheetGrid sheet={open} />
        </section>
      )}
    </>
  );
}
