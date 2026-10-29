'use client';

import type { PortalDto } from '@workhub/shared';
import Link from 'next/link';
import { DocStatus, KIND_LABEL, docMoney } from './client-docs';

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const STATUS: Record<PortalDto['projects'][number]['status'], string> = { active: 'In progress', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' };

/** What a client's contacts see: shared projects, approved hours, and documents sent to them. */
export function PortalView({ portal, docHref }: { portal: PortalDto; docHref: (id: string) => string }) {
  const most = Math.max(1, ...portal.hoursByMonth.map((m) => m.hours));
  return (
    <div className="space-y-8">
      <section aria-labelledby="projects">
        <h2 id="projects" className="text-base font-semibold">
          Projects
        </h2>
        {portal.projects.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-8 text-center text-sm text-gray-600">{portal.workspaceName} hasn’t shared any projects here yet.</p>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {portal.projects.map((p) => (
              <article key={p.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  <span className="text-xs text-gray-500">{STATUS[p.status]}</span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={p.tasks.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} progress`}>
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${p.tasks.percent}%` }} />
                  </div>
                  <span className="text-sm font-medium tabular-nums">{p.tasks.percent}%</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{p.tasks.total ? `${p.tasks.done} of ${p.tasks.total} tasks done` : 'No tasks yet'}</p>
                {p.columns.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">
                    {p.columns.map((c) => (
                      <li key={c.name} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                        {c.name}: <span className="tabular-nums">{c.open}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">Hours worked</dt>
                    <dd className="font-semibold tabular-nums">
                      {p.approvedHours}
                      {p.budgetHours !== null && <span className="font-normal text-gray-500"> of {p.budgetHours} planned</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">This month</dt>
                    <dd className="font-semibold tabular-nums">{p.hoursThisMonth}</dd>
                  </div>
                </dl>
                {p.upcoming.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-gray-500">Coming up</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {p.upcoming.map((u) => (
                        <li key={`${u.title}${u.dueDate}`} className="flex justify-between gap-2">
                          <span className="truncate">{u.title}</span>
                          <span className="shrink-0 text-gray-500">{shortDate(u.dueDate)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="hours">
        <h2 id="hours" className="text-base font-semibold">
          Hours worked
        </h2>
        <p className="text-xs text-gray-500">Approved hours on the projects above, by month.</p>
        <div className="mt-3 flex h-40 items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4" role="img" aria-label={portal.hoursByMonth.map((m) => `${monthName(m.month)}: ${m.hours} hours`).join(', ')}>
          {portal.hoursByMonth.map((m) => (
            <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-xs tabular-nums text-gray-600">{m.hours}</span>
              <div className="w-full max-w-12 rounded-t bg-brand-500" style={{ height: `${(m.hours / most) * 70}%`, minHeight: m.hours > 0 ? 2 : 0 }} />
              <span className="text-xs text-gray-500">{monthName(m.month)}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="docs">
        <h2 id="docs" className="text-base font-semibold">
          Quotes and invoices
        </h2>
        {portal.documents.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
            {portal.documents.map((d) => (
              <li key={d.id}>
                <Link href={docHref(d.id)} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
                  <span className="font-medium text-brand-700">
                    {KIND_LABEL[d.kind]} {d.number}
                  </span>
                  <span className="text-gray-500">{shortDate(d.issueDate)}</span>
                  <span className="ms-auto tabular-nums">{docMoney(d.total, d.currency)}</span>
                  <DocStatus status={d.status} overdue={d.overdue} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
