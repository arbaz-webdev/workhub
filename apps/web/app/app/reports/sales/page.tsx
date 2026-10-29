'use client';

import { hasRole, LEAD_SOURCE_LABELS, type SalesReportDto } from '@workhub/shared';
import { useEffect, useState } from 'react';
import { amounts, downloadCsv, pct, ReportTabs, Stat } from '@/components/reports/shared';
import { Alert, PageHeader, btn } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { addDays, localToday } from '@/lib/time';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const PERIODS = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 12 months', days: 365 },
];

export default function SalesReportPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [days, setDays] = useState(90);
  const [data, setData] = useState<SalesReportDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!hasRole(workspace.role, 'manager')) return;
    const to = localToday();
    api<SalesReportDto>(`/reports/sales?from=${addDays(to, 1 - days)}&to=${to}`)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the report.'));
  }, [api, days, workspace.role]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title="Reports" />
        <Alert>Reports are for managers and above.</Alert>
      </>
    );
  }

  const maxStage = data ? Math.max(1, ...data.stages.map((s) => s.count)) : 1;

  function csv() {
    if (!data) return;
    downloadCsv(`sales-${data.from}-to-${data.to}.csv`, [
      ['Salesperson', 'Activities', 'Calls', 'Meetings', 'Deals won', 'Won value', 'Open deals'],
      ...data.people.map((p) => [p.person.name, p.activities, p.calls, p.meetings, p.won, amounts(p.wonValue), p.open]),
      [],
      ['Source', 'Leads', 'Converted', 'Deals won', 'Won value'],
      ...data.sources.map((s) => [s.source === 'direct' ? 'Direct (no lead)' : LEAD_SOURCE_LABELS[s.source], s.leads, s.converted, s.won, amounts(s.wonValue)]),
    ]);
  }

  return (
    <>
      <PageHeader title="Reports" description="What’s in the pipeline, what you win, where it comes from, and who’s selling." />
      <ReportTabs />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            type="button"
            onClick={() => setDays(p.days)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${days === p.days ? 'bg-brand-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'}`}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className={`${btn.secondary} ms-auto`} onClick={csv} disabled={!data}>
          Download CSV
        </button>
      </div>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!data ? (
        !error && <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open pipeline" value={amounts(data.open)} hint={`Forecast ${amounts(data.weighted)}`} />
            <Stat label="Won in period" value={amounts(data.won.value)} hint={`${data.won.count} deal${data.won.count === 1 ? '' : 's'}`} tone={data.won.count ? 'good' : undefined} />
            <Stat label="Win rate" value={pct(data.winRate)} hint={`${data.won.count} won, ${data.lost.count} lost`} />
            <Stat label="Average time to win" value={data.avgDaysToWin === null ? '—' : `${data.avgDaysToWin} days`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold">Open deals by stage</h2>
              {data.stages.length === 0 ? (
                <p className="text-sm text-gray-500">No open deals.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.stages.map((s) => (
                    <li key={s.stage} className="text-sm">
                      <div className="flex justify-between">
                        <span>
                          {s.stage} <span className="text-gray-400">{s.probability}%</span>
                        </span>
                        <span className="tabular-nums text-gray-600">
                          {s.count} · {amounts(s.value)}
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${(s.count / maxStage) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold">Why deals were lost</h2>
              {data.lostReasons.length === 0 ? (
                <p className="text-sm text-gray-500">No lost deals in this period.</p>
              ) : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {data.lostReasons.map((r) => (
                    <li key={r.reason} className="flex justify-between py-1.5">
                      <span className="text-gray-800">{r.reason}</span>
                      <span className="tabular-nums text-gray-600">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <h2 className="px-4 pt-4 text-sm font-semibold">Where deals come from</h2>
            <table className="mt-2 w-full min-w-[560px] text-sm">
              <thead className="border-y border-gray-200 bg-gray-50 text-start text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2 text-end">New leads</th>
                  <th className="px-3 py-2 text-end">Converted</th>
                  <th className="px-3 py-2 text-end">Deals won</th>
                  <th className="px-3 py-2 text-end">Won value</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      No leads or wins in this period.
                    </td>
                  </tr>
                )}
                {data.sources.map((s) => (
                  <tr key={s.source} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-medium">{s.source === 'direct' ? 'Direct (no lead)' : LEAD_SOURCE_LABELS[s.source]}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{s.leads}</td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {s.converted}
                      {s.leads > 0 && <span className="ms-1 text-xs text-gray-500">({Math.round((s.converted / s.leads) * 100)}%)</span>}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{s.won}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{amounts(s.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <h2 className="px-4 pt-4 text-sm font-semibold">Salespeople</h2>
            <table className="mt-2 w-full min-w-[620px] text-sm">
              <thead className="border-y border-gray-200 bg-gray-50 text-start text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2 text-end">Activities</th>
                  <th className="px-3 py-2 text-end">Calls</th>
                  <th className="px-3 py-2 text-end">Meetings</th>
                  <th className="px-3 py-2 text-end">Won</th>
                  <th className="px-3 py-2 text-end">Won value</th>
                  <th className="px-3 py-2 text-end">Open deals</th>
                </tr>
              </thead>
              <tbody>
                {data.people.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      No sales activity in this period.
                    </td>
                  </tr>
                )}
                {data.people.map((p) => (
                  <tr key={p.person.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-medium">{p.person.name}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.activities}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.calls}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.meetings}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.won}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{amounts(p.wonValue)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  );
}
