'use client';

import { hasRole, type ProfitabilityDto } from '@workhub/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { amount, downloadCsv, pct, ReportTabs, Stat } from '@/components/reports/shared';
import { Alert, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { localToday } from '@/lib/time';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

function shift(month: string, by: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export default function ProfitabilityPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const thisMonth = localToday().slice(0, 7);
  const [from, setFrom] = useState(shift(thisMonth, -5));
  const [to, setTo] = useState(thisMonth);
  const [data, setData] = useState<ProfitabilityDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!hasRole(workspace.role, 'admin')) return;
    api<ProfitabilityDto>(`/reports/profitability?from=${from}&to=${to}`)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the report.'));
  }, [api, from, to, workspace.role]);

  if (!hasRole(workspace.role, 'admin')) {
    return (
      <>
        <PageHeader title="Reports" />
        <ReportTabs />
        <Alert>Client profitability uses salaries, so only the owner and admins can see it.</Alert>
      </>
    );
  }

  const max = data ? Math.max(1, ...data.total.byMonth.map((m) => Math.max(m.revenue, m.cost))) : 1;

  function csv() {
    if (!data) return;
    downloadCsv(`client-profitability-${from}-to-${to}.csv`, [
      ['Client', 'Revenue', 'Cost', 'Profit', 'Margin %', 'Hours', 'Billable hours'],
      ...data.clients.map((c) => [c.client?.name ?? 'No client', c.revenue, c.cost, c.profit, c.margin, c.hours, c.billableHours]),
      ['Total', data.total.revenue, data.total.cost, data.total.profit, data.total.margin, data.total.hours, data.total.billableHours],
    ]);
  }

  return (
    <>
      <PageHeader title="Reports" description="Which clients make you money: what you earned from each, against what your team’s time on them cost." />
      <ReportTabs />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="text-gray-700">From</span>
          <input type="month" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`mt-1 ${input} !w-40`} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">To</span>
          <input type="month" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={`mt-1 ${input} !w-40`} />
        </label>
        <button type="button" className={`${btn.secondary} ml-auto`} onClick={csv} disabled={!data}>
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
          {(data.missingRates.length > 0 || data.peopleWithoutCost.length > 0) && (
            <div role="status" className="space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {data.missingRates.length > 0 && (
                <p>
                  Revenue in {data.missingRates.join(', ')} is left out: there’s no exchange rate for it.{' '}
                  <Link href="/app/reports/costs" className="font-medium underline">
                    Add one
                  </Link>
                </p>
              )}
              {data.peopleWithoutCost.length > 0 && (
                <p>
                  No monthly cost set for {data.peopleWithoutCost.map((p) => p.name).join(', ')}, so their hours cost nothing here.{' '}
                  <Link href="/app/reports/costs" className="font-medium underline">
                    Set costs
                  </Link>
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue" value={amount(data.total.revenue, data.currency)} />
            <Stat label="Cost of time" value={amount(data.total.cost, data.currency)} hint={`${data.total.hours} h logged`} />
            <Stat label="Profit" value={amount(data.total.profit, data.currency)} tone={data.total.profit >= 0 ? 'good' : 'bad'} />
            <Stat label="Margin" value={pct(data.total.margin)} hint={data.total.billableHours ? `${data.total.billableHours} h billable` : undefined} />
          </div>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold">By month</h2>
            <p className="mb-4 flex gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> Revenue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-300" /> Cost
              </span>
            </p>
            <div className="flex h-40 items-end gap-2 overflow-x-auto" role="img" aria-label="Revenue and cost by month">
              {data.total.byMonth.map((m) => (
                <div key={m.month} className="flex min-w-12 flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end justify-center gap-1" title={`${monthLabel(m.month)}: revenue ${amount(m.revenue, data.currency)}, cost ${amount(m.cost, data.currency)}`}>
                    <div className="w-1/3 rounded-t bg-brand-500" style={{ height: `${(m.revenue / max) * 100}%` }} />
                    <div className="w-1/3 rounded-t bg-rose-300" style={{ height: `${(m.cost / max) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-500">{monthLabel(m.month)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Profit</th>
                  <th className="px-3 py-2 text-right">Margin</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-right">Per hour</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                      No revenue or hours in these months yet.
                    </td>
                  </tr>
                )}
                {data.clients.map((c) => (
                  <tr key={c.client?.id ?? 'none'} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {c.client ? (
                        <Link href={`/app/crm/companies/${c.client.id}`} className="hover:underline">
                          {c.client.name}
                        </Link>
                      ) : (
                        <span className="text-gray-500">No client (internal)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(c.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(c.cost)}</td>
                    <td className={`px-3 py-2 text-right font-medium tabular-nums ${c.profit < 0 ? 'text-red-600' : 'text-gray-900'}`}>{amount(c.profit)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${c.margin !== null && c.margin < 20 ? 'text-amber-700' : ''}`}>{pct(c.margin)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.hours}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{c.hours > 0 ? amount(c.revenue / c.hours) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {data.clients.length > 0 && (
                <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <tr>
                    <td className="px-3 py-2">Total ({data.currency})</td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(data.total.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(data.total.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(data.total.profit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(data.total.margin)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.total.hours}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.total.hours > 0 ? amount(data.total.revenue / data.total.hours) : '—'}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </section>
          <p className="text-xs text-gray-500">
            Revenue is won deals (in the month they were won) plus billable hours on projects with an hourly rate. Cost is hours logged × each person’s monthly cost ÷ the monthly working hours set in Costs and rates.
          </p>
        </div>
      )}
    </>
  );
}
