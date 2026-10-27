'use client';

import { ACTIVITY_KINDS, ACTIVITY_LABELS, activitySchema, type ActivityKind, type CrmActivityDto } from '@workhub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { btn, input, timeAgo } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';
import { errorText } from './shared';

export type ActivityTarget = { dealId?: string; companyId?: string; contactId?: string; leadId?: string };

const KIND_COLOR: Record<ActivityKind, string> = {
  call: 'bg-sky-100 text-sky-800',
  meeting: 'bg-violet-100 text-violet-800',
  email: 'bg-amber-100 text-amber-800',
  whatsapp: 'bg-emerald-100 text-emerald-800',
  note: 'bg-gray-100 text-gray-700',
  task: 'bg-rose-100 text-rose-800',
};

export function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** The local date and time an hour from now, for a datetime-local input. */
function inAnHour() {
  const d = new Date(Date.now() + 3600_000);
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** One activity: what, when, and a tick box while it's a pending follow-up. */
export function ActivityRow({ a, onToggle, showTarget = false }: { a: CrmActivityDto; onToggle: (done: boolean) => void; showTarget?: boolean }) {
  const pending = !a.doneAt && !!a.dueAt;
  const target = a.deal
    ? { href: `/app/crm/deals?open=${a.deal.id}`, label: a.deal.title }
    : a.company
      ? { href: `/app/crm/companies/${a.company.id}`, label: a.company.name }
      : a.lead
        ? { href: `/app/crm/leads?open=${a.lead.id}`, label: a.lead.name }
        : a.contact
          ? { href: `/app/crm/contacts?open=${a.contact.id}`, label: a.contact.name }
          : null;
  return (
    <li className="flex gap-3 py-2.5">
      {a.dueAt ? (
        <input
          type="checkbox"
          checked={!!a.doneAt}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={a.doneAt ? `Mark “${a.subject}” as not done` : `Mark “${a.subject}” as done`}
          className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
        />
      ) : (
        <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${KIND_COLOR[a.kind]}`}>
          {ACTIVITY_LABELS[a.kind][0]}
        </span>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <p className={`font-medium ${a.doneAt && a.dueAt ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
          {a.subject}
          <span className="ml-2 text-xs font-normal text-gray-500">{ACTIVITY_LABELS[a.kind]}</span>
        </p>
        {a.body && <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-700">{a.body}</p>}
        <p className="mt-0.5 text-xs text-gray-500">
          {pending ? (
            <span className={a.overdue ? 'font-medium text-red-600' : ''}>
              {a.overdue ? 'Overdue · ' : 'Due '}
              {when(a.dueAt!)}
            </span>
          ) : (
            <>
              {a.createdBy?.name ?? 'Someone'} · {timeAgo(a.doneAt ?? a.createdAt)}
            </>
          )}
          {a.owner && pending && <> · {a.owner.name}</>}
          {showTarget && target && (
            <>
              {' · '}
              <Link href={target.href} className="text-brand-700 hover:underline">
                {target.label}
              </Link>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

/** Log something that happened, or schedule a follow-up. */
function ActivityForm({ target, onSaved }: { target: ActivityTarget; onSaved: () => void }) {
  const api = useWorkspaceApi();
  const [kind, setKind] = useState<ActivityKind>('call');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [later, setLater] = useState(false);
  const [due, setDue] = useState(inAnHour);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = activitySchema.safeParse({ kind, subject, body: body || null, dueAt: later ? new Date(due).toISOString() : null, ...target });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSaving(true);
    try {
      await api('/crm/activities', { method: 'POST', body: parsed.data });
      setSubject('');
      setBody('');
      setLater(false);
      setError(undefined);
      onSaved();
    } catch (err) {
      setError(errorText(err, 'Could not save it.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl bg-gray-50 p-3">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Kind">
        {ACTIVITY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${kind === k ? 'bg-brand-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
          >
            {ACTIVITY_LABELS[k]}
          </button>
        ))}
      </div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={later ? 'What to do, e.g. Send the proposal' : 'What happened, e.g. Called about pricing'} aria-label="Subject" maxLength={200} required className={input} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" aria-label="Details" rows={2} maxLength={5000} className={input} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Follow up on
        </label>
        {later && <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Follow-up time" className={`${input} !w-auto !py-1.5`} />}
        <button type="submit" disabled={saving} className={`${btn.primary} ml-auto !py-1.5`}>
          {saving ? 'Saving…' : later ? 'Schedule' : 'Log it'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

/** Activities on a record, with a form to add one. */
export function ActivityPanel({ target, initial }: { target: ActivityTarget; initial?: CrmActivityDto[] }) {
  const api = useWorkspaceApi();
  const [items, setItems] = useState<CrmActivityDto[] | undefined>(initial);
  const query = new URLSearchParams(Object.entries(target).filter(([, v]) => v) as [string, string][]).toString();

  const load = useCallback(() => {
    api<CrmActivityDto[]>(`/crm/activities?${query}`)
      .then(setItems)
      .catch(() => {});
  }, [api, query]);
  useEffect(() => {
    if (!initial) load();
  }, [initial, load]);

  async function toggle(a: CrmActivityDto, done: boolean) {
    setItems((list) => list?.map((x) => (x.id === a.id ? { ...x, doneAt: done ? new Date().toISOString() : null, overdue: false } : x)));
    await api(`/crm/activities/${a.id}`, { method: 'PATCH', body: { done } }).catch(load);
  }

  return (
    <div className="space-y-3">
      <ActivityForm target={target} onSaved={load} />
      {!items ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing logged yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((a) => (
            <ActivityRow key={a.id} a={a} onToggle={(d) => void toggle(a, d)} />
          ))}
        </ul>
      )}
    </div>
  );
}
