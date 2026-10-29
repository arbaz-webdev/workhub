'use client';

import type { TimesheetDto } from '@workhub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { TIMER_EVENT } from '@/components/shell/timer-chip';
import { SheetStatus, TimesheetGrid, TimesheetTabs } from '@/components/timesheets/grid';
import { Alert, PageHeader, btn } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { addDays, dayLabel } from '@/lib/time';
import { useWorkspaceApi } from '@/lib/workspace';

export default function TimesheetPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
      <MyTimesheet />
    </Suspense>
  );
}

function MyTimesheet() {
  const api = useWorkspaceApi();
  const router = useRouter();
  const params = useSearchParams();
  const week = params.get('week');
  const [sheet, setSheet] = useState<TimesheetDto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<TimesheetDto>(`/timesheets/me${week ? `?week=${week}` : ''}`)
      .then((s) => {
        setSheet(s);
        setError(undefined);
      })
      .catch(() => setError('Could not load your timesheet.'));
  }, [api, week]);

  useEffect(() => {
    load();
    window.addEventListener(TIMER_EVENT, load);
    return () => window.removeEventListener(TIMER_EVENT, load);
  }, [load]);

  const go = (w: string) => router.push(`/app/timesheets?week=${w}`, { scroll: false });

  async function submit() {
    if (!sheet) return;
    setBusy(true);
    setError(undefined);
    try {
      setSheet(await api<TimesheetDto>('/timesheets/submit', { method: 'POST', body: { weekStart: sheet.weekStart } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the timesheet.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Timesheets" description="Your week, from timers and logged time." />
      <TimesheetTabs />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!sheet ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button type="button" className={btn.ghost} aria-label="Previous week" onClick={() => go(addDays(sheet.weekStart, -7))}>
              ←
            </button>
            <span className="font-medium">
              {dayLabel(sheet.weekStart, { day: 'numeric', month: 'short' })} – {dayLabel(sheet.days[6]!, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button type="button" className={btn.ghost} aria-label="Next week" onClick={() => go(addDays(sheet.weekStart, 7))}>
              →
            </button>
            <SheetStatus status={sheet.status} />
            {(sheet.status === 'draft' || sheet.status === 'rejected') && (
              <button type="button" className={`${btn.primary} ms-auto`} disabled={busy || sheet.total === 0} onClick={submit}>
                {busy ? 'Submitting…' : sheet.status === 'rejected' ? 'Resubmit week' : 'Submit week'}
              </button>
            )}
          </div>
          {sheet.status === 'rejected' && (
            <div className="mb-4">
              <Alert>
                Sent back by {sheet.decidedByName ?? 'your manager'}
                {sheet.decisionNote ? `: “${sheet.decisionNote}”` : '.'} Fix the time on the tasks, then resubmit.
              </Alert>
            </div>
          )}
          {sheet.status === 'submitted' && <p className="mb-4 text-sm text-gray-600">This week is locked while it waits for approval.</p>}
          {sheet.status === 'approved' && <p className="mb-4 text-sm text-gray-600">Approved by {sheet.decidedByName ?? 'your manager'}. This week is locked.</p>}
          <TimesheetGrid sheet={sheet} />
        </>
      )}
    </>
  );
}
