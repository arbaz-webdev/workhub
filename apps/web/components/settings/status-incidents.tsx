'use client';

import {
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  STATUS_COMPONENT_LABELS,
  STATUS_COMPONENTS,
  type IncidentImpact,
  type IncidentStatus,
  type StatusComponent,
  type StatusPageDto,
} from '@workhub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, btn, input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

const IMPACT_LABEL: Record<IncidentImpact, string> = { minor: 'Minor: something is slow or broken for some', major: 'Major: WorkHub is down for many', maintenance: 'Planned maintenance' };
const STATUS_LABEL: Record<IncidentStatus, string> = { investigating: 'Investigating', identified: 'Cause found', monitoring: 'Fixed, watching', resolved: 'Resolved' };

/** WorkHub staff: post incidents and updates to the public status page. */
export function StatusIncidents() {
  const [open, setOpen] = useState<StatusPageDto['incidents']>([]);
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState<IncidentImpact>('minor');
  const [components, setComponents] = useState<StatusComponent[]>([]);
  const [body, setBody] = useState('');
  const [updates, setUpdates] = useState<Record<string, { status: IncidentStatus; body: string }>>({});
  const [result, setResult] = useState<{ kind: 'error' | 'success'; text: string }>();

  const load = useCallback(() => {
    api<StatusPageDto>('/status')
      .then((p) => setOpen(p.incidents.filter((i) => !i.resolvedAt)))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setResult(undefined);
    try {
      await fn();
      setResult({ kind: 'success', text: done });
      load();
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : 'That didn’t save.' });
    }
  }

  const post = () =>
    run(async () => {
      await api('/platform/incidents', { method: 'POST', body: { title, impact, components, body } });
      setTitle('');
      setBody('');
      setComponents([]);
    }, 'Posted to the status page.');

  return (
    <div className="mt-8">
      <Card
        title="Status page"
        description="Tell customers when something is wrong or maintenance is planned. Updates appear on the public status page within a minute."
      >
        <div className="space-y-5" aria-live="polite">
          {result && <Alert kind={result.kind}>{result.text}</Alert>}
          {open.map((i) => {
            const u = updates[i.id] ?? { status: 'monitoring' as IncidentStatus, body: '' };
            return (
              <form
                key={i.id}
                className="rounded-xl border border-amber-200 bg-amber-50 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api(`/platform/incidents/${i.id}/updates`, { method: 'POST', body: u }), u.status === 'resolved' ? 'Resolved.' : 'Update posted.');
                }}
              >
                <p className="font-medium">{i.title}</p>
                <p className="text-xs text-gray-600">Latest: {i.updates[0] ? `${STATUS_LABEL[i.updates[0].status]}: ${i.updates[0].body}` : 'none'}</p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <select aria-label="Status" value={u.status} onChange={(e) => setUpdates({ ...updates, [i.id]: { ...u, status: e.target.value as IncidentStatus } })} className={`${input} sm:!w-44`}>
                    {INCIDENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <input aria-label="Update" value={u.body} onChange={(e) => setUpdates({ ...updates, [i.id]: { ...u, body: e.target.value } })} placeholder="What’s changed" maxLength={2000} className={`${input} flex-1`} />
                  <button type="submit" className={btn.primary}>
                    Post update
                  </button>
                </div>
              </form>
            );
          })}

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void post();
            }}
          >
            <p className="text-sm font-semibold">New incident</p>
            <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Check-ins are slow" maxLength={150} className={input} />
            <select aria-label="Impact" value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)} className={input}>
              {INCIDENT_IMPACTS.map((x) => (
                <option key={x} value={x}>
                  {IMPACT_LABEL[x]}
                </option>
              ))}
            </select>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <legend className="sr-only">Affected parts</legend>
              {STATUS_COMPONENTS.map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <input type="checkbox" checked={components.includes(c)} onChange={(e) => setComponents(e.target.checked ? [...components, c] : components.filter((x) => x !== c))} />
                  {STATUS_COMPONENT_LABELS[c]}
                </label>
              ))}
            </fieldset>
            <textarea aria-label="What customers should know" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What customers should know, in plain words" rows={3} maxLength={2000} className={input} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={btn.primary} disabled={title.trim().length < 3 || body.trim().length < 3}>
                Post incident
              </button>
              <Link href="/status" className="text-sm text-brand-700 underline">
                View the status page
              </Link>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
