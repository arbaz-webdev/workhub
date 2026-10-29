'use client';

import {
  hasRole,
  holidaySchema,
  LEAVE_COLORS,
  leaveTypeSchema,
  type HolidayDto,
  type LeaveTypeDto,
  type MemberDto,
} from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { LEAVE_COLOR, LeaveTabs } from '@/components/leave/tabs';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback);

export default function LeaveSettingsPage() {
  const { workspace } = useWorkspace();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const done = (m: string) => {
    setError(undefined);
    setNotice(m);
    setTimeout(() => setNotice(undefined), 4000);
  };

  if (!hasRole(workspace.role, 'admin')) {
    return (
      <>
        <PageHeader title="Leave" />
        <LeaveTabs />
        <Alert>Only admins can change leave types and holidays.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Leave" description="Leave types, public holidays and balance adjustments." />
      <LeaveTabs />
      <div className="mb-4 space-y-2" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
      </div>
      <div className="space-y-6">
        <Holidays onDone={done} onError={setError} />
        <Types onDone={done} onError={setError} />
        <Adjustments onDone={done} onError={setError} />
      </div>
    </>
  );
}

// ---- Holidays -----------------------------------------------------------------------

function Holidays({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [list, setList] = useState<HolidayDto[]>();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');

  const load = useCallback(() => {
    api<HolidayDto[]>(`/holidays?year=${year}`)
      .then(setList)
      .catch(() => onError('Could not load holidays.'));
  }, [api, year, onError]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      onDone(message);
      load();
    } catch (err) {
      onError(errorText(err, 'Could not save.'));
    }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = holidaySchema.safeParse({ date, name });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Check the holiday.');
    void run(() => api('/holidays', { method: 'POST', body: parsed.data }), `Added ${name}.`).then(() => {
      setDate('');
      setName('');
    });
  };

  return (
    <Card title="Holidays" description="Nobody is marked absent on a holiday, and leave doesn’t count it.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button type="button" className={btn.secondary} onClick={() => run(() => api('/holidays/load-pakistan', { method: 'POST', body: { year } }), `Pakistan’s ${year} holidays are loaded.`)}>
          Load Pakistan’s {year} holidays
        </button>
        <span className="text-xs text-gray-500">Islamic dates are estimates: edit them when the moon-sighting is announced.</span>
      </div>
      {list && list.length > 0 && (
        <ul className="mb-4 divide-y divide-gray-100 text-sm">
          {list.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              {editing === h.id ? (
                <>
                  <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} aria-label={`New date for ${h.name}`} className="rounded-lg border border-gray-300 px-2 py-1" />
                  <span className="flex-1">{h.name}</span>
                  <button
                    type="button"
                    className={btn.ghost}
                    onClick={() => run(() => api(`/holidays/${h.id}`, { method: 'PATCH', body: { date: editDate, name: h.name } }), `${h.name} moved.`).then(() => setEditing(null))}
                  >
                    Save
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="w-28 tabular-nums text-gray-600">{new Date(`${h.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
                  <span className="flex-1">
                    {h.name}
                    {h.estimated && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Estimated</span>}
                    {h.kind === 'company' && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">Company</span>}
                  </span>
                  <button
                    type="button"
                    className={btn.ghost}
                    onClick={() => {
                      setEditing(h.id);
                      setEditDate(h.date);
                    }}
                  >
                    {h.estimated ? 'Set date' : 'Edit'}
                  </button>
                  <button type="button" className={btn.danger} onClick={() => window.confirm(`Remove ${h.name}?`) && run(() => api(`/holidays/${h.id}`, { method: 'DELETE' }), `Removed ${h.name}.`)}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {list && list.length === 0 && <p className="mb-4 text-sm text-gray-500">No holidays for {year} yet.</p>}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="text-gray-700">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${input}`} required />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Company anniversary" className={`mt-1 ${input}`} required maxLength={80} />
        </label>
        <button type="submit" className={btn.secondary}>
          Add holiday
        </button>
      </form>
    </Card>
  );
}

// ---- Leave types --------------------------------------------------------------------

function Types({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [types, setTypes] = useState<LeaveTypeDto[]>();
  const [editing, setEditing] = useState<LeaveTypeDto | 'new' | null>(null);

  const load = useCallback(() => {
    api<LeaveTypeDto[]>('/leave/types')
      .then(setTypes)
      .catch(() => onError('Could not load leave types.'));
  }, [api, onError]);
  useEffect(load, [load]);

  async function archive(t: LeaveTypeDto) {
    if (!window.confirm(`Stop offering ${t.name} leave? Past requests are kept.`)) return;
    try {
      await api(`/leave/types/${t.id}`, { method: 'DELETE' });
      onDone(`${t.name} removed.`);
      load();
    } catch (err) {
      onError(errorText(err, 'Could not remove it.'));
    }
  }

  return (
    <Card title="Leave types" description="Monthly types earn a twelfth of the year’s days each month; yearly ones give them all in January (prorated for new joiners).">
      <ul className="divide-y divide-gray-100 text-sm">
        {types?.map((t) =>
          editing !== 'new' && editing?.id === t.id ? (
            <li key={t.id} className="py-3">
              <TypeForm type={t} onCancel={() => setEditing(null)} onSaved={(m) => (setEditing(null), load(), onDone(m))} onError={onError} />
            </li>
          ) : (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEAVE_COLOR[t.color]}`}>{t.name}</span>
              <span className="flex-1 text-gray-600">
                {t.daysPerYear === null ? 'No limit' : `${t.daysPerYear} days a year, ${t.accrual === 'monthly' ? 'earned monthly' : 'given yearly'}`}
                {!t.paid && ' · unpaid'}
              </span>
              <button type="button" className={btn.ghost} onClick={() => setEditing(t)}>
                Edit
              </button>
              <button type="button" className={btn.danger} onClick={() => archive(t)}>
                Remove
              </button>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <div className="mt-3 border-t border-gray-100 pt-4">
          <TypeForm onCancel={() => setEditing(null)} onSaved={(m) => (setEditing(null), load(), onDone(m))} onError={onError} />
        </div>
      ) : (
        <button type="button" className={`${btn.secondary} mt-3`} onClick={() => setEditing('new')}>
          Add leave type
        </button>
      )}
    </Card>
  );
}

function TypeForm({ type, onCancel, onSaved, onError }: { type?: LeaveTypeDto; onCancel: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [name, setName] = useState(type?.name ?? '');
  const [paid, setPaid] = useState(type?.paid ?? true);
  const [limited, setLimited] = useState(type ? type.daysPerYear !== null : true);
  const [daysPerYear, setDays] = useState(String(type?.daysPerYear ?? 10));
  const [accrual, setAccrual] = useState<'yearly' | 'monthly'>(type?.accrual ?? 'yearly');
  const [color, setColor] = useState<(typeof LEAVE_COLORS)[number]>(type?.color ?? 'blue');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = leaveTypeSchema.safeParse({ name, paid, daysPerYear: limited ? Number(daysPerYear) : null, accrual, color });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Check the leave type.');
    try {
      await api(type ? `/leave/types/${type.id}` : '/leave/types', { method: type ? 'PATCH' : 'POST', body: parsed.data });
      onSaved(type ? `Saved ${name}.` : `Added ${name}.`);
    } catch (err) {
      onError(errorText(err, 'Could not save.'));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      <label>
        <span className="text-gray-700">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${input} !w-40`} required maxLength={40} />
      </label>
      <label className="flex items-center gap-2 pb-2">
        <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} />
        Limited to
      </label>
      {limited && (
        <>
          <label>
            <span className="text-gray-700">Days a year</span>
            <input type="number" min={0} max={365} step={0.5} value={daysPerYear} onChange={(e) => setDays(e.target.value)} className={`mt-1 ${input} !w-24`} />
          </label>
          <label>
            <span className="text-gray-700">Earned</span>
            <select value={accrual} onChange={(e) => setAccrual(e.target.value as 'yearly' | 'monthly')} className={`mt-1 ${input}`}>
              <option value="yearly">All at once each year</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </>
      )}
      <label className="flex items-center gap-2 pb-2">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        Paid
      </label>
      <label>
        <span className="text-gray-700">Colour</span>
        <select value={color} onChange={(e) => setColor(e.target.value as (typeof LEAVE_COLORS)[number])} className={`mt-1 ${input}`}>
          {LEAVE_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={btn.primary}>
        {type ? 'Save' : 'Add'}
      </button>
      <button type="button" className={btn.ghost} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

// ---- Adjustments --------------------------------------------------------------------

function Adjustments({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [people, setPeople] = useState<MemberDto[]>([]);
  const [types, setTypes] = useState<LeaveTypeDto[]>([]);
  const [userId, setUserId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const year = new Date().getFullYear();

  useEffect(() => {
    api<MemberDto[]>('/members')
      .then((m) => setPeople(m.filter((p) => p.role !== 'guest')))
      .catch(() => {});
    api<LeaveTypeDto[]>('/leave/types')
      .then((t) => setTypes(t.filter((x) => x.daysPerYear !== null)))
      .catch(() => {});
  }, [api]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/leave/adjustments', { method: 'POST', body: { userId, leaveTypeId: typeId, year, days: Number(days), reason } });
      onDone('Balance adjusted.');
      setDays('');
      setReason('');
    } catch (err) {
      onError(errorText(err, 'Could not adjust the balance.'));
    }
  }

  return (
    <Card title="Adjust a balance" description={`Add days carried over, or take off leave someone used before joining (${year}). Use a minus sign to take days away.`}>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="text-gray-700">Person</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`mt-1 ${input}`} required>
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-gray-700">Type</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={`mt-1 ${input}`} required>
            <option value="">Choose…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-gray-700">Days</span>
          <input type="number" step={0.5} min={-365} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={`mt-1 ${input} !w-24`} required />
        </label>
        <label className="min-w-48 flex-1">
          <span className="text-gray-700">Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Carried over from last year" className={`mt-1 ${input}`} required maxLength={300} />
        </label>
        <button type="submit" className={btn.secondary}>
          Adjust
        </button>
      </form>
    </Card>
  );
}
