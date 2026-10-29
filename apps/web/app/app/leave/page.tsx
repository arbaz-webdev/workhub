'use client';

import { leaveRequestSchema, type HalfDay, type MyLeaveDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { LEAVE_COLOR, LeaveTabs, rangeLabel, StatusPill } from '@/components/leave/tabs';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export default function MyLeavePage() {
  const api = useWorkspaceApi();
  const [data, setData] = useState<MyLeaveDto>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<MyLeaveDto>('/leave/me')
      .then(setData)
      .catch(() => setError('Could not load your leave.'));
  }, [api]);
  useEffect(load, [load]);

  async function cancel(id: string) {
    setError(undefined);
    try {
      await api(`/leave/requests/${id}/cancel`, { method: 'POST' });
      setNotice('Request withdrawn.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not withdraw the request.');
    }
  }

  return (
    <>
      <PageHeader title="Leave" description="Your balances, requests and time off." />
      <LeaveTabs />
      <div className="mb-4 space-y-2" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
      </div>
      {!data ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <section aria-label="Balances" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.balances.map((b) => (
              <div key={b.leaveType.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <span className={`h-2.5 w-2.5 rounded-full ${LEAVE_COLOR[b.leaveType.color]?.split(' ')[0]}`} aria-hidden="true" />
                  {b.leaveType.name}
                  {!b.leaveType.paid && <span className="text-xs font-normal text-gray-500">unpaid</span>}
                </p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{b.available === null ? '∞' : b.available}</p>
                <p className="text-xs text-gray-500">
                  {b.available === null ? 'No limit' : `available of ${b.entitled! + b.adjustments} earned in ${data.year}`}
                  {b.used > 0 && ` · ${b.used} used`}
                  {b.pending > 0 && ` · ${b.pending} waiting`}
                </p>
              </div>
            ))}
          </section>

          <RequestForm data={data} onDone={(m) => (setNotice(m), setError(undefined), load())} onError={setError} />

          <Card title="Your requests" description={`This year (${data.year}).`}>
            {data.requests.length === 0 ? (
              <p className="text-sm text-gray-500">No leave requested yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${LEAVE_COLOR[r.leaveType.color]}`}>{r.leaveType.name}</span>
                    <span className="font-medium">{rangeLabel(r.startDate, r.endDate, r.halfDay)}</span>
                    <span className="text-gray-500">{days(r.days)}</span>
                    <StatusPill status={r.status} />
                    {r.decisionNote && <span className="text-gray-500">“{r.decisionNote}”</span>}
                    {r.status === 'pending' && (
                      <button type="button" className={`${btn.ghost} ml-auto`} onClick={() => cancel(r.id)}>
                        Withdraw
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function RequestForm({ data, onDone, onError }: { data: MyLeaveDto; onDone: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [typeId, setTypeId] = useState(data.balances[0]?.leaveType.id ?? '');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [halfDay, setHalfDay] = useState<HalfDay>('none');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ days: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const single = !!start && (start === end || !end);

  // How many days the dates take, as the dates change.
  useEffect(() => {
    setPreview(null);
    const finish = end || start;
    if (!start || finish < start) return;
    const q = new URLSearchParams({ startDate: start, endDate: finish, halfDay: single ? halfDay : 'none' });
    const t = setTimeout(() => {
      api<{ days: number }>(`/leave/preview?${q}`)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [api, start, end, halfDay, single]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = leaveRequestSchema.safeParse({ leaveTypeId: typeId, startDate: start, endDate: end || start, halfDay: single ? halfDay : 'none', reason: reason || undefined });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Check the request.');
    setSaving(true);
    try {
      await api('/leave/requests', { method: 'POST', body: parsed.data });
      setStart('');
      setEnd('');
      setHalfDay('none');
      setReason('');
      onDone('Request sent. Your manager has been told.');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not send the request.');
    } finally {
      setSaving(false);
    }
  }

  const label = 'text-sm font-medium text-gray-700';
  return (
    <Card title="Ask for leave">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-4">
        <label className="block">
          <span className={label}>Type</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={`mt-1 ${input}`}>
            {data.balances.map((b) => (
              <option key={b.leaveType.id} value={b.leaveType.id}>
                {b.leaveType.name}
                {b.available !== null ? ` (${b.available} left)` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>From</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`mt-1 ${input}`} required />
        </label>
        <label className="block">
          <span className={label}>To</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={`mt-1 ${input}`} placeholder="Same day" />
        </label>
        <label className="block">
          <span className={label}>Length</span>
          <select value={single ? halfDay : 'none'} disabled={!single} onChange={(e) => setHalfDay(e.target.value as HalfDay)} className={`mt-1 ${input}`}>
            <option value="none">Full day{single ? '' : 's'}</option>
            <option value="first">First half</option>
            <option value="second">Second half</option>
          </select>
        </label>
        <label className="block sm:col-span-4">
          <span className={label}>Reason (optional)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Only your managers see this" className={`mt-1 ${input}`} />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
          <button type="submit" className={btn.primary} disabled={saving || !start || preview?.days === 0}>
            {saving ? 'Sending…' : 'Send request'}
          </button>
          <span className="text-sm text-gray-600" role="status">
            {preview && (preview.days === 0 ? 'Those are all days off or holidays: no leave needed.' : `Takes ${days(preview.days)} (weekends and holidays don’t count).`)}
          </span>
        </div>
      </form>
    </Card>
  );
}
