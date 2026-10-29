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
import { prettyDate } from '@/components/attendance/labels';
import { LEAVE_COLOR, LeaveTabs } from '@/components/leave/tabs';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback);

export default function LeaveSettingsPage() {
  const { workspace } = useWorkspace();
  const t = useT();
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
        <PageHeader title={t('leave.title')} />
        <LeaveTabs />
        <Alert>{t('leave.settings.adminsOnly')}</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('leave.title')} description={t('leave.settings.description')} />
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
  const t = useT();
  const locale = useLocale();
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
      .catch(() => onError(t('leave.holidays.loadError')));
  }, [api, year, onError, t]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      onDone(message);
      load();
    } catch (err) {
      onError(errorText(err, t('common.couldNotSave')));
    }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = holidaySchema.safeParse({ date, name });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? t('leave.holidays.check'));
    void run(() => api('/holidays', { method: 'POST', body: parsed.data }), t('leave.holidays.added', { name })).then(() => {
      setDate('');
      setName('');
    });
  };

  return (
    <Card title={t('leave.holidays.title')} description={t('leave.holidays.description')}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={t('leave.holidays.year')} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={btn.secondary}
          onClick={() => run(() => api('/holidays/load-pakistan', { method: 'POST', body: { year } }), t('leave.holidays.loadedPakistan', { year }))}
        >
          {t('leave.holidays.loadPakistan', { year })}
        </button>
        <span className="text-xs text-gray-500">{t('leave.holidays.estimatesNote')}</span>
      </div>
      {list && list.length > 0 && (
        <ul className="mb-4 divide-y divide-gray-100 text-sm">
          {list.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              {editing === h.id ? (
                <>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    aria-label={t('leave.holidays.newDate', { name: h.name })}
                    className="rounded-lg border border-gray-300 px-2 py-1"
                  />
                  <span className="flex-1">{h.name}</span>
                  <button
                    type="button"
                    className={btn.ghost}
                    onClick={() =>
                      run(() => api(`/holidays/${h.id}`, { method: 'PATCH', body: { date: editDate, name: h.name } }), t('leave.holidays.moved', { name: h.name })).then(() =>
                        setEditing(null),
                      )
                    }
                  >
                    {t('common.save')}
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => setEditing(null)}>
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <span className="w-28 tabular-nums text-gray-600">{prettyDate(h.date, undefined, locale)}</span>
                  <span className="flex-1">
                    {h.name}
                    {h.estimated && <span className="ms-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{t('leave.holidays.estimated')}</span>}
                    {h.kind === 'company' && <span className="ms-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{t('leave.holidays.company')}</span>}
                  </span>
                  <button
                    type="button"
                    className={btn.ghost}
                    onClick={() => {
                      setEditing(h.id);
                      setEditDate(h.date);
                    }}
                  >
                    {h.estimated ? t('leave.holidays.setDate') : t('common.edit')}
                  </button>
                  <button
                    type="button"
                    className={btn.danger}
                    onClick={() =>
                      window.confirm(t('leave.holidays.confirmRemove', { name: h.name })) &&
                      run(() => api(`/holidays/${h.id}`, { method: 'DELETE' }), t('leave.holidays.removed', { name: h.name }))
                    }
                  >
                    {t('common.remove')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {list && list.length === 0 && <p className="mb-4 text-sm text-gray-500">{t('leave.holidays.none', { year })}</p>}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="text-gray-700">{t('leave.holidays.date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${input}`} required />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">{t('leave.holidays.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('leave.holidays.namePlaceholder')} className={`mt-1 ${input}`} required maxLength={80} />
        </label>
        <button type="submit" className={btn.secondary}>
          {t('leave.holidays.add')}
        </button>
      </form>
    </Card>
  );
}

// ---- Leave types --------------------------------------------------------------------

function Types({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const t = useT();
  const [types, setTypes] = useState<LeaveTypeDto[]>();
  const [editing, setEditing] = useState<LeaveTypeDto | 'new' | null>(null);

  const load = useCallback(() => {
    api<LeaveTypeDto[]>('/leave/types')
      .then(setTypes)
      .catch(() => onError(t('leave.types.loadError')));
  }, [api, onError, t]);
  useEffect(load, [load]);

  async function archive(type: LeaveTypeDto) {
    if (!window.confirm(t('leave.types.confirmArchive', { name: type.name }))) return;
    try {
      await api(`/leave/types/${type.id}`, { method: 'DELETE' });
      onDone(t('leave.types.removed', { name: type.name }));
      load();
    } catch (err) {
      onError(errorText(err, t('leave.types.removeFailed')));
    }
  }

  return (
    <Card title={t('leave.types.title')} description={t('leave.types.description')}>
      <ul className="divide-y divide-gray-100 text-sm">
        {types?.map((type) =>
          editing !== 'new' && editing?.id === type.id ? (
            <li key={type.id} className="py-3">
              <TypeForm type={type} onCancel={() => setEditing(null)} onSaved={(m) => (setEditing(null), load(), onDone(m))} onError={onError} />
            </li>
          ) : (
            <li key={type.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEAVE_COLOR[type.color]}`}>{type.name}</span>
              <span className="flex-1 text-gray-600">
                {type.daysPerYear === null
                  ? t('leave.mine.noLimit')
                  : t(type.accrual === 'monthly' ? 'leave.types.monthly' : 'leave.types.yearly', { n: type.daysPerYear })}
                {!type.paid && t('leave.types.unpaid')}
              </span>
              <button type="button" className={btn.ghost} onClick={() => setEditing(type)}>
                {t('common.edit')}
              </button>
              <button type="button" className={btn.danger} onClick={() => archive(type)}>
                {t('common.remove')}
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
          {t('leave.types.add')}
        </button>
      )}
    </Card>
  );
}

function TypeForm({ type, onCancel, onSaved, onError }: { type?: LeaveTypeDto; onCancel: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const t = useT();
  const [name, setName] = useState(type?.name ?? '');
  const [paid, setPaid] = useState(type?.paid ?? true);
  const [limited, setLimited] = useState(type ? type.daysPerYear !== null : true);
  const [daysPerYear, setDays] = useState(String(type?.daysPerYear ?? 10));
  const [accrual, setAccrual] = useState<'yearly' | 'monthly'>(type?.accrual ?? 'yearly');
  const [color, setColor] = useState<(typeof LEAVE_COLORS)[number]>(type?.color ?? 'blue');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = leaveTypeSchema.safeParse({ name, paid, daysPerYear: limited ? Number(daysPerYear) : null, accrual, color });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? t('leave.types.check'));
    try {
      await api(type ? `/leave/types/${type.id}` : '/leave/types', { method: type ? 'PATCH' : 'POST', body: parsed.data });
      onSaved(type ? t('leave.types.saved', { name }) : t('leave.types.added', { name }));
    } catch (err) {
      onError(errorText(err, t('common.couldNotSave')));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      <label>
        <span className="text-gray-700">{t('leave.types.name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${input} !w-40`} required maxLength={40} />
      </label>
      <label className="flex items-center gap-2 pb-2">
        <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} />
        {t('leave.types.limitedTo')}
      </label>
      {limited && (
        <>
          <label>
            <span className="text-gray-700">{t('leave.types.daysAYear')}</span>
            <input type="number" min={0} max={365} step={0.5} value={daysPerYear} onChange={(e) => setDays(e.target.value)} className={`mt-1 ${input} !w-24`} />
          </label>
          <label>
            <span className="text-gray-700">{t('leave.types.earned')}</span>
            <select value={accrual} onChange={(e) => setAccrual(e.target.value as 'yearly' | 'monthly')} className={`mt-1 ${input}`}>
              <option value="yearly">{t('leave.types.earnedYearly')}</option>
              <option value="monthly">{t('leave.types.earnedMonthly')}</option>
            </select>
          </label>
        </>
      )}
      <label className="flex items-center gap-2 pb-2">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        {t('leave.types.paid')}
      </label>
      <label>
        <span className="text-gray-700">{t('leave.types.colour')}</span>
        <select value={color} onChange={(e) => setColor(e.target.value as (typeof LEAVE_COLORS)[number])} className={`mt-1 ${input}`}>
          {LEAVE_COLORS.map((c) => (
            <option key={c} value={c}>
              {t(`color.${c}`)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={btn.primary}>
        {type ? t('common.save') : t('common.add')}
      </button>
      <button type="button" className={btn.ghost} onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </form>
  );
}

// ---- Adjustments --------------------------------------------------------------------

function Adjustments({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const t = useT();
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
      .then((list) => setTypes(list.filter((x) => x.daysPerYear !== null)))
      .catch(() => {});
  }, [api]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/leave/adjustments', { method: 'POST', body: { userId, leaveTypeId: typeId, year, days: Number(days), reason } });
      onDone(t('leave.adjust.done'));
      setDays('');
      setReason('');
    } catch (err) {
      onError(errorText(err, t('leave.adjust.failed')));
    }
  }

  return (
    <Card title={t('leave.adjust.title')} description={t('leave.adjust.description', { year })}>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="text-gray-700">{t('leave.adjust.person')}</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`mt-1 ${input}`} required>
            <option value="">{t('common.choose')}</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-gray-700">{t('leave.adjust.type')}</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={`mt-1 ${input}`} required>
            <option value="">{t('common.choose')}</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-gray-700">{t('leave.adjust.days')}</span>
          <input type="number" step={0.5} min={-365} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={`mt-1 ${input} !w-24`} required />
        </label>
        <label className="min-w-48 flex-1">
          <span className="text-gray-700">{t('leave.adjust.reason')}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('leave.adjust.reasonPlaceholder')} className={`mt-1 ${input}`} required maxLength={300} />
        </label>
        <button type="submit" className={btn.secondary}>
          {t('leave.adjust.submit')}
        </button>
      </form>
    </Card>
  );
}
