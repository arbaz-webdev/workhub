'use client';

import { hasRole, type UtilisationDto } from '@workhub/shared';
import { useEffect, useState } from 'react';
import { downloadCsv, Meter, pct, ReportTabs, Stat } from '@/components/reports/shared';
import { Alert, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { addDays, localToday, mondayOf } from '@/lib/time';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

function presets() {
  const today = localToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const monday = mondayOf(today);
  return [
    { label: 'This week', from: monday, to: addDays(monday, 6) },
    { label: 'Last week', from: addDays(monday, -7), to: addDays(monday, -1) },
    { label: 'This month', from: monthStart, to: today },
    { label: 'Last month', from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
  ];
}

export default function UtilisationPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const options = presets();
  const [from, setFrom] = useState(options[2]!.from);
  const [to, setTo] = useState(options[2]!.to);
  const [data, setData] = useState<UtilisationDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!hasRole(workspace.role, 'manager')) return;
    api<UtilisationDto>(`/reports/utilisation?from=${from}&to=${to}`)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the report.'));
  }, [api, from, to, workspace.role]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title="Reports" />
        <Alert>Reports are for managers and above.</Alert>
      </>
    );
  }

  function csv() {
    if (!data) return;
    downloadCsv(`utilisation-${from}-to-${to}.csv`, [
      ['Person', 'Team', 'Hours', 'Billable hours', 'Capacity hours', 'Utilisation %'],
      ...data.people.map((p) => [p.person.name, p.team?.name ?? '', p.hours, p.billableHours, p.capacityHours, p.utilisation]),
    ]);
  }

  return (
    <>
      <PageHeader title="Reports" description="How much of your team’s working time goes on billable work." />
      <ReportTabs />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => {
              setFrom(o.from);
              setTo(o.to);
            }}
            className={`rounded-full px-3 py-1 text-sm font-medium ${from === o.from && to === o.to ? 'bg-brand-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'}`}
          >
            {o.label}
          </button>
        ))}
        <label className="ms-2 text-sm">
          <span className="sr-only">From</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${input} !w-40 !py-1.5`} />
        </label>
        <span className="pb-2 text-gray-400">–</span>
        <label className="text-sm">
          <span className="sr-only">To</span>
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={`${input} !w-40 !py-1.5`} />
        </label>
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
            <Stat label="Utilisation" value={pct(data.total.utilisation)} hint="Billable hours ÷ capacity" />
            <Stat label="Billable hours" value={`${data.total.billableHours} h`} />
            <Stat label="All hours logged" value={`${data.total.hours} h`} />
            <Stat label="Capacity" value={`${data.total.capacityHours} h`} hint="Working days, less holidays and leave, × 8 h" />
          </div>

          {data.teams.length > 1 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold">By team</h2>
              <ul className="space-y-3">
                {data.teams.map((t) => (
                  <li key={t.team?.id ?? 'none'} className="grid grid-cols-[minmax(7rem,1fr)_3fr_auto] items-center gap-3 text-sm">
                    <span className="truncate font-medium">
                      {t.team?.name ?? 'No team'} <span className="font-normal text-gray-500">({t.people})</span>
                    </span>
                    <Meter value={t.utilisation} label={`${t.team?.name ?? 'No team'} utilisation`} />
                    <span className="w-14 text-end tabular-nums">{pct(t.utilisation)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-start text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2 text-end">Logged</th>
                  <th className="px-3 py-2 text-end">Billable</th>
                  <th className="px-3 py-2 text-end">Capacity</th>
                  <th className="w-48 px-3 py-2">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.person.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-medium">{p.person.name}</td>
                    <td className="px-3 py-2 text-gray-600">{p.team?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.hours} h</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.billableHours} h</td>
                    <td className="px-3 py-2 text-end tabular-nums text-gray-600">{p.capacityHours} h</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <Meter value={p.utilisation} label={`${p.person.name} utilisation`} warnAbove={100} />
                        <span className="w-12 text-end tabular-nums">{pct(p.utilisation)}</span>
                      </span>
                    </td>
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
