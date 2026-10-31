'use client';

import { hasRole, type CorrectionDto, type LeaveRequestDto } from '@workhub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LEAVE_COLOR, LeaveTabs, rangeLabel } from '@/components/leave/tabs';
import { Alert, Card, PageHeader, btn, input, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

export default function ApprovalsPage() {
  const { workspace, me } = useWorkspace();
  const api = useWorkspaceApi();
  const [leave, setLeave] = useState<LeaveRequestDto[]>();
  const [corrections, setCorrections] = useState<CorrectionDto[]>();
  const [tz, setTz] = useState('Asia/Karachi');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<LeaveRequestDto[]>('/leave/requests?status=pending')
      .then(setLeave)
      .catch(() => setError('Could not load leave requests.'));
    api<CorrectionDto[]>('/attendance/corrections?status=pending')
      .then(setCorrections)
      .catch(() => setError('Could not load corrections.'));
    api<{ timezone: string }>('/workspaces/current')
      .then((w) => setTz(w.timezone))
      .catch(() => {});
  }, [api]);
  useEffect(load, [load]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title="Leave" />
        <LeaveTabs />
        <Alert>Only managers can approve requests.</Alert>
      </>
    );
  }

  async function decide(path: string, decision: 'approve' | 'reject', note: string, label: string) {
    setError(undefined);
    try {
      await api(`${path}/${decision}`, { method: 'POST', body: { note: note || undefined } });
      setNotice(`${label} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the decision.');
    }
  }

  // Your own requests wait for someone else, unless you're the owner.
  const mayDecide = (userId: string) => userId !== me.user.id || workspace.role === 'owner';
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });

  return (
    <>
      <PageHeader title="Leave" description="Requests waiting for a decision." />
      <LeaveTabs />
      <div className="mb-4 space-y-2" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
      </div>
      <div className="space-y-6">
        <Card title="Leave requests">
          {!leave ? (
            <Loading />
          ) : leave.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing waiting.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {leave.map((r) => (
                <Decision
                  key={r.id}
                  canDecide={mayDecide(r.user.id)}
                  onDecide={(d, note) => decide(`/leave/requests/${r.id}`, d, note, `${r.user.name}’s leave`)}
                >
                  <p className="font-medium">
                    {r.user.name}{' '}
                    <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${LEAVE_COLOR[r.leaveType.color]}`}>{r.leaveType.name}</span>
                  </p>
                  <p className="text-gray-600">
                    {rangeLabel(r.startDate, r.endDate, r.halfDay)} · {r.days} {r.days === 1 ? 'day' : 'days'}
                    {r.reason && <span className="text-gray-500"> · “{r.reason}”</span>}
                  </p>
                </Decision>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Attendance corrections">
          {!corrections ? (
            <Loading />
          ) : corrections.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing waiting.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {corrections.map((c) => (
                <Decision key={c.id} canDecide={mayDecide(c.user.id)} onDecide={(d, note) => decide(`/attendance/corrections/${c.id}`, d, note, `${c.user.name}’s correction`)}>
                  <p className="font-medium">{c.user.name}</p>
                  <p className="text-gray-600">
                    {rangeLabel(c.date, c.date)}: in {time(c.checkInAt)}, out {time(c.checkOutAt)}
                    <span className="text-gray-500"> · “{c.reason}”</span>
                  </p>
                </Decision>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-sm text-gray-600">
          Timesheets are approved on the <Link href="/app/timesheets/approvals" className="underline">Timesheets</Link> page.
        </p>
      </div>
    </>
  );
}

function Decision({ children, canDecide, onDecide }: { children: React.ReactNode; canDecide: boolean; onDecide: (d: 'approve' | 'reject', note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (d: 'approve' | 'reject') => {
    setBusy(true);
    await onDecide(d, note);
    setBusy(false);
  };
  return (
    <li className="flex flex-wrap items-start gap-3 py-3 text-sm">
      <div className="min-w-0 flex-1">{children}</div>
      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" maxLength={500} className={`${input} !w-48 !py-1.5`} />
          <button type="button" className={`${btn.primary} !py-1.5`} disabled={busy} onClick={() => go('approve')}>
            Approve
          </button>
          <button type="button" className={btn.danger} disabled={busy} onClick={() => go('reject')}>
            Reject
          </button>
        </div>
      ) : (
        <span className="text-xs text-gray-500">Your own: someone else decides</span>
      )}
    </li>
  );
}
