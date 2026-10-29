'use client';

import type { IncidentStatus, StatusPageDto } from '@workhub/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const STATE = {
  operational: { label: 'Working', dot: 'bg-brand-500', text: 'text-brand-700' },
  degraded: { label: 'Slow', dot: 'bg-amber-500', text: 'text-amber-700' },
  down: { label: 'Not working', dot: 'bg-red-500', text: 'text-red-700' },
} as const;

const UPDATE_LABEL: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified: 'Cause found',
  monitoring: 'Fixed, watching',
  resolved: 'Resolved',
};

function barColour(uptime: number | null) {
  if (uptime === null) return 'bg-gray-200';
  if (uptime >= 99.9) return 'bg-brand-500';
  if (uptime >= 99) return 'bg-amber-400';
  return 'bg-red-500';
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Live component states, 90 days of uptime, and incidents; refreshes every minute. */
export function StatusBoard() {
  const [page, setPage] = useState<StatusPageDto>();
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const load = () =>
      api<StatusPageDto>('/status')
        .then((p) => {
          setPage(p);
          setUnreachable(false);
        })
        .catch(() => setUnreachable(true));
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (unreachable) {
    return (
      <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800" role="status">
        <p className="font-semibold">WorkHub isn’t answering right now.</p>
        <p className="mt-1 text-sm">We’re checking again every minute. If it lasts, message us on WhatsApp.</p>
      </div>
    );
  }
  if (!page) return <p className="mt-8 text-sm text-gray-500">Checking…</p>;

  const open = page.incidents.filter((i) => !i.resolvedAt);
  const down = page.components.filter((c) => c.state !== 'operational');
  const allGood = down.length === 0 && open.length === 0;

  return (
    <div className="mt-8 space-y-8" aria-live="polite">
      <div className={`rounded-2xl p-5 ${allGood ? 'bg-brand-600 text-white' : 'border border-amber-200 bg-amber-50 text-amber-900'}`} role="status">
        <p className="text-lg font-semibold">{allGood ? 'Everything is working' : open[0] ? open[0].title : 'Some parts of WorkHub have problems'}</p>
        <p className={`mt-1 text-sm ${allGood ? 'text-brand-50' : ''}`}>Checked {when(page.checkedAt)}</p>
      </div>

      {open.length > 0 && <Incidents title="Now" incidents={open} />}

      <section aria-labelledby="components">
        <h2 id="components" className="text-base font-semibold">
          Last 90 days
        </h2>
        <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          {page.components.map((c) => {
            const s = STATE[c.state];
            return (
              <li key={c.key} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.label}</span>
                  <span className={`flex items-center gap-2 text-sm font-medium ${s.text}`}>
                    <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                    {s.label}
                  </span>
                </div>
                {/* 90 days on wider screens, the last 30 on phones. */}
                <div className="mt-3 flex h-8 gap-px" role="img" aria-label={c.uptime === null ? 'No history yet' : `${c.uptime}% uptime over the days recorded`}>
                  {c.days.map((d, i) => (
                    <span
                      key={d.day}
                      title={`${day(d.day)}: ${d.uptime === null ? 'no checks' : `${d.uptime}%`}`}
                      className={`flex-1 rounded-sm ${barColour(d.uptime)} ${i < c.days.length - 30 ? 'hidden sm:block' : ''}`}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>
                    <span className="sm:hidden">30 days ago</span>
                    <span className="hidden sm:inline">90 days ago</span>
                  </span>
                  <span>{c.uptime === null ? 'No history yet' : `${c.uptime}% uptime`}</span>
                  <span>Today</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <Incidents title="Past incidents" incidents={page.incidents.filter((i) => i.resolvedAt)} empty="No incidents in the last 14 days." />

      <p className="text-xs text-gray-500">
        WorkHub checks each part every minute. Grey days have no checks recorded.
      </p>
    </div>
  );
}

function Incidents({ title, incidents, empty }: { title: string; incidents: StatusPageDto['incidents']; empty?: string }) {
  return (
    <section aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      {incidents.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {incidents.map((i) => (
            <li key={i.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{i.title}</h3>
                <span className="text-xs text-gray-500">
                  {i.impact === 'maintenance' ? 'Planned maintenance' : i.impact === 'major' ? 'Major' : 'Minor'} · {when(i.startedAt)}
                </span>
              </div>
              <ol className="mt-3 space-y-2 border-l-2 border-gray-100 pl-3">
                {i.updates.map((u) => (
                  <li key={u.createdAt} className="text-sm">
                    <span className="font-medium">{UPDATE_LABEL[u.status]}</span> <span className="text-xs text-gray-500">{when(u.createdAt)}</span>
                    <p className="text-gray-700">{u.body}</p>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
