'use client';

import {
  createWebhookSchema,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENTS,
  type WebhookCreatedDto,
  type WebhookDeliveryDto,
  type WebhookDto,
} from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, btn, input, timeAgo } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';

type Event = (typeof WEBHOOK_EVENTS)[number];

const DELIVERY_STYLE: Record<WebhookDeliveryDto['status'], [string, string]> = {
  delivered: ['Delivered', 'bg-emerald-100 text-emerald-800'],
  pending: ['Retrying', 'bg-amber-100 text-amber-800'],
  failed: ['Failed', 'bg-red-100 text-red-700'],
};

function DeliveryLine({ d }: { d: WebhookDeliveryDto }) {
  const [label, style] = DELIVERY_STYLE[d.status];
  const waiting = d.status === 'pending' && d.attempts === 0;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${waiting ? 'bg-gray-100 text-gray-600' : style}`}>{waiting ? 'Waiting' : label}</span>
      <span className="font-mono text-xs text-gray-700">{d.event}</span>
      <span className="text-xs text-gray-500">
        {timeAgo(d.createdAt)}
        {d.attempts > 1 && ` · ${d.attempts} tries`}
        {d.lastStatus !== null && ` · HTTP ${d.lastStatus}`}
        {d.status !== 'delivered' && d.lastError && ` · ${d.lastError}`}
      </span>
    </span>
  );
}

/** Settings → API: webhooks that tell other software when things happen. */
export function Webhooks() {
  const api = useWorkspaceApi();
  const [hooks, setHooks] = useState<WebhookDto[]>();
  const [created, setCreated] = useState<WebhookCreatedDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<WebhookDto[]>('/webhooks')
      .then(setHooks)
      .catch(() => setError('Could not load your webhooks.'));
  }, [api]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
      if (done) setNotice(done);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Please try again.');
    }
  }

  async function test(hook: WebhookDto) {
    setError(undefined);
    setNotice(undefined);
    try {
      const d = await api<WebhookDeliveryDto>(`/webhooks/${hook.id}/test`, { method: 'POST' });
      if (d.status === 'delivered') setNotice(`Test delivered to ${hook.url} (HTTP ${d.lastStatus}).`);
      else setError(`The test didn't arrive: ${d.lastError ?? 'no answer'}.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the test.');
    }
  }

  return (
    <Card
      title="Webhooks"
      description="WorkHub tells another system, at an address you give, the moment something happens: someone checks in, leave is approved, a deal is won. Each message is signed so the system can trust it."
    >
      <div className="space-y-4" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {created && <NewSecret created={created} onDone={() => setCreated(null)} />}

        {!hooks ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : hooks.length === 0 ? (
          <p className="text-sm text-gray-500">No webhooks yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {hooks.map((h) => (
              <HookRow
                key={h.id}
                hook={h}
                onTest={() => test(h)}
                onPause={(paused) => run(() => api(`/webhooks/${h.id}`, { method: 'PATCH', body: { paused } }), paused ? 'Webhook paused.' : 'Webhook resumed. Anything that waited is being sent.')}
                onDelete={() => window.confirm(`Delete the webhook to ${h.url}? It stops at once.`) && run(() => api(`/webhooks/${h.id}`, { method: 'DELETE' }), 'Webhook deleted.')}
              />
            ))}
          </ul>
        )}

        {adding ? (
          <AddWebhook
            onCancel={() => setAdding(false)}
            onCreated={(w) => {
              setCreated(w);
              setAdding(false);
              setError(undefined);
              load();
            }}
            onError={setError}
          />
        ) : (
          <button type="button" className={btn.secondary} onClick={() => setAdding(true)}>
            Add a webhook
          </button>
        )}
      </div>
    </Card>
  );
}

function HookRow({ hook, onTest, onPause, onDelete }: { hook: WebhookDto; onTest: () => void; onPause: (paused: boolean) => void; onDelete: () => void }) {
  const api = useWorkspaceApi();
  const [log, setLog] = useState<WebhookDeliveryDto[] | null>(null);

  async function toggleLog() {
    if (log) return setLog(null);
    setLog(await api<WebhookDeliveryDto[]>(`/webhooks/${hook.id}/deliveries`).catch(() => []));
  }

  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="break-all font-medium text-gray-900">{hook.url}</p>
          <p className="text-xs text-gray-500">{hook.events.map((e) => WEBHOOK_EVENT_LABELS[e]).join(' · ')}</p>
        </div>
        {hook.pausedAt ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Paused</span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">On</span>
        )}
      </div>
      {hook.pausedReason && (
        <p className="text-xs text-amber-800">
          {hook.pausedReason}
          {hook.pending > 0 && ` ${hook.pending} waiting to be sent when you resume.`}
        </p>
      )}
      <div className="text-xs text-gray-600">
        {hook.lastDelivery ? (
          <span className="flex flex-wrap items-center gap-1">
            Last: <DeliveryLine d={hook.lastDelivery} />
          </span>
        ) : (
          'Nothing sent yet.'
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {!hook.pausedAt && (
          <button type="button" className={btn.ghost} onClick={onTest}>
            Send a test
          </button>
        )}
        <button type="button" className={btn.ghost} onClick={toggleLog} aria-expanded={!!log}>
          {log ? 'Hide deliveries' : 'Deliveries'}
        </button>
        <button type="button" className={btn.ghost} onClick={() => onPause(!hook.pausedAt)}>
          {hook.pausedAt ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className={btn.danger} onClick={onDelete}>
          Delete
        </button>
      </div>
      {log && (
        <ul className="space-y-1.5 rounded-lg bg-gray-50 p-3">
          {log.length === 0 && <li className="text-xs text-gray-500">Nothing sent yet.</li>}
          {log.map((d) => (
            <li key={d.id}>
              <DeliveryLine d={d} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AddWebhook({ onCancel, onCreated, onError }: { onCancel: () => void; onCreated: (w: WebhookCreatedDto) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Event[]>([]);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createWebhookSchema.safeParse({ url, events });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Check the webhook.');
    setSaving(true);
    try {
      onCreated(await api<WebhookCreatedDto>('/webhooks', { method: 'POST', body: parsed.data }));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not add the webhook.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-gray-200 p-4 text-sm">
      <label className="block">
        <span className="text-gray-700">Address to send to</span>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/workhub-events" className={`mt-1 ${input}`} required />
      </label>
      <fieldset>
        <legend className="text-gray-700">Send when</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2">
              <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents((cur) => (e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev)))} className="h-4 w-4 accent-brand-600" />
              {WEBHOOK_EVENT_LABELS[ev]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className={btn.primary} disabled={saving}>
          {saving ? 'Adding…' : 'Add webhook'}
        </button>
        <button type="button" className={btn.ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The signing secret, shown once. */
function NewSecret({ created, onDone }: { created: WebhookCreatedDto; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm">
      <p className="font-medium text-gray-900">Signing secret for {created.url}</p>
      <p className="mt-1 text-gray-600">The receiving system uses it to check each message came from WorkHub. Copy it now; you won&apos;t see it again.</p>
      <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 font-mono text-gray-900">{created.secret}</code>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={btn.secondary}
          onClick={() => {
            void navigator.clipboard?.writeText(created.secret);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy secret'}
        </button>
        <button type="button" className={btn.primary} onClick={onDone}>
          I&apos;ve saved it
        </button>
      </div>
    </div>
  );
}
