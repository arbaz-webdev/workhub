'use client';

import { CURRENCIES, hasRole, type CostSettingsDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { amount, ReportTabs } from '@/components/reports/shared';
import { Alert, Card, PageHeader, btn, input, roleLabel } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

export default function CostsPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [data, setData] = useState<CostSettingsDto>();
  const [hours, setHours] = useState('');
  const [rates, setRates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<CostSettingsDto>('/reports/costs')
      .then((d) => {
        setData(d);
        setHours(String(d.monthlyHours));
        setRates(Object.fromEntries(Object.entries(d.fxRates).map(([k, v]) => [k, String(v)])));
      })
      .catch(() => setError('Could not load cost settings.'));
  }, [api]);
  useEffect(() => {
    if (hasRole(workspace.role, 'admin')) load();
  }, [load, workspace.role]);

  if (!hasRole(workspace.role, 'admin')) {
    return (
      <>
        <PageHeader title="Reports" />
        <ReportTabs />
        <Alert>Costs include salaries, so only the owner and admins can see them.</Alert>
      </>
    );
  }

  async function run(fn: () => Promise<unknown>, done: string) {
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
      setNotice(done);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : 'Could not save that.');
    }
  }

  const others = CURRENCIES.filter((c) => c !== data?.currency);
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));

  return (
    <>
      <PageHeader title="Reports" description="What an hour costs and what work earns, for the profitability report. Only owners and admins see this page." />
      <ReportTabs />
      <div className="space-y-6" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {!data ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <Card title="Working hours and exchange rates" description={`Everything is reported in ${data.currency}, your workspace currency.`}>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fxRates = Object.fromEntries(Object.entries(rates).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]));
                  void run(() => api('/reports/costs', { method: 'PATCH', body: { monthlyHours: Number(hours), fxRates } }), 'Saved.');
                }}
              >
                <label className="block text-sm">
                  <span className="text-gray-700">Working hours in a month</span>
                  <input type="number" min={1} max={744} value={hours} onChange={(e) => setHours(e.target.value)} className={`mt-1 ${input} !w-32`} />
                  <span className="mt-1 block text-xs text-gray-500">A monthly cost is divided by this to get an hourly cost. 176 is 22 days of 8 hours.</span>
                </label>
                <fieldset>
                  <legend className="text-sm text-gray-700">Exchange rates</legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    {others.map((c) => (
                      <label key={c} className="flex items-center gap-2 text-sm">
                        <span className="w-14 text-gray-600">1 {c} =</span>
                        <input type="number" min={0} step="any" value={rates[c] ?? ''} onChange={(e) => setRates({ ...rates, [c]: e.target.value })} aria-label={`${data.currency} per ${c}`} className={`${input} !w-28`} />
                        <span className="text-gray-500">{data.currency}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button type="submit" className={btn.primary}>
                  Save
                </button>
              </form>
            </Card>

            <Card title="Monthly cost of each person" description="Salary plus anything else they cost you each month. Leave blank if you’d rather not include someone.">
              <ul className="divide-y divide-gray-100">
                {data.people.map((p) => (
                  <CostRow
                    key={p.person.id + String(p.monthlyCost)}
                    label={p.person.name}
                    sub={roleLabel(p.role)}
                    initial={p.monthlyCost}
                    hint={p.hourlyCost === null ? 'Not set' : `${amount(p.hourlyCost, data.currency)} an hour`}
                    onSave={(v) => run(() => api(`/reports/costs/people/${p.person.id}`, { method: 'PUT', body: { monthlyCost: num(v) } }), `Saved ${p.person.name}’s cost.`)}
                    unit={data.currency}
                  />
                ))}
              </ul>
            </Card>

            <Card title="Hourly rates" description="For time-and-materials work: billable hours on these projects count as revenue at this rate. Leave blank for fixed-price projects, whose revenue comes from won deals.">
              {data.projects.length === 0 ? (
                <p className="text-sm text-gray-500">No projects yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.projects.map((p) => (
                    <RateRow
                      key={p.id + String(p.hourlyRate) + p.rateCurrency}
                      label={p.name}
                      sub={p.client?.name ?? 'No client'}
                      rate={p.hourlyRate}
                      currency={p.rateCurrency ?? data.currency}
                      onSave={(rate, currency) => run(() => api(`/reports/costs/projects/${p.id}`, { method: 'PUT', body: { hourlyRate: num(rate), currency } }), `Saved the rate for ${p.name}.`)}
                    />
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function CostRow({ label, sub, initial, hint, unit, onSave }: { label: string; sub: string; initial: number | null; hint: string; unit: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial === null ? '' : String(initial));
  const changed = v !== (initial === null ? '' : String(initial));
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
      <span className="min-w-40 flex-1">
        <span className="font-medium">{label}</span> <span className="text-gray-500">· {sub}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-gray-500">{unit}</span>
        <input type="number" min={0} step="any" value={v} onChange={(e) => setV(e.target.value)} aria-label={`${label}’s monthly cost`} className={`${input} !w-36`} />
        <button type="button" className={`${btn.secondary} !py-1.5`} disabled={!changed} onClick={() => onSave(v)}>
          Save
        </button>
      </span>
    </li>
  );
}

function RateRow({ label, sub, rate, currency, onSave }: { label: string; sub: string; rate: number | null; currency: string; onSave: (rate: string, currency: string) => void }) {
  const [v, setV] = useState(rate === null ? '' : String(rate));
  const [c, setC] = useState(currency);
  const changed = v !== (rate === null ? '' : String(rate)) || c !== currency;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
      <span className="min-w-40 flex-1">
        <span className="font-medium">{label}</span> <span className="text-gray-500">· {sub}</span>
      </span>
      <span className="flex items-center gap-2">
        <select value={c} onChange={(e) => setC(e.target.value)} aria-label={`${label} rate currency`} className={`${input} !w-24`}>
          {CURRENCIES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <input type="number" min={0} step="any" value={v} onChange={(e) => setV(e.target.value)} placeholder="Fixed price" aria-label={`${label} hourly rate`} className={`${input} !w-28`} />
        <span className="text-gray-500">/ h</span>
        <button type="button" className={`${btn.secondary} !py-1.5`} disabled={!changed} onClick={() => onSave(v, c)}>
          Save
        </button>
      </span>
    </li>
  );
}
