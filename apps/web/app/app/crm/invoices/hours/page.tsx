'use client';

import { CURRENCIES, type ClientDocumentDto, type CompanyDto, type Currency, type UnbilledProjectDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { docMoney } from '@/components/crm/client-docs';
import { CrmTabs, errorText, Labelled, ManagersOnly } from '@/components/crm/shared';
import { Alert, PageHeader, btn, input } from '@/components/ui';
import { localToday } from '@/lib/time';
import { useWorkspaceApi } from '@/lib/workspace';

/** Last calendar month, the usual billing period. */
function lastMonth(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** Invoice a client for approved, billable hours that haven't been billed yet. */
export default function BillHoursPage() {
  return (
    <ManagersOnly>
      <BillHours />
    </ManagersOnly>
  );
}

function BillHours() {
  const api = useWorkspaceApi();
  const router = useRouter();
  const today = localToday();
  const [clients, setClients] = useState<CompanyDto[]>();
  const [client, setClient] = useState('');
  const [{ from, to }, setRange] = useState(lastMonth(today));
  const [projects, setProjects] = useState<UnbilledProjectDto[]>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [taxRate, setTaxRate] = useState('0');
  const [taxLabel, setTaxLabel] = useState('');
  const [dueDays, setDueDays] = useState('14');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CompanyDto[]>('/companies')
      .then(setClients)
      .catch(() => setError('Could not load your clients.'));
  }, [api]);

  useEffect(() => {
    if (!client || !from || !to) return;
    setProjects(undefined);
    api<UnbilledProjectDto[]>(`/client-docs/unbilled?companyId=${client}&from=${from}&to=${to}`)
      .then((list) => {
        setProjects(list);
        // Start with the projects that can be billed, in the most common currency among them.
        const billable = list.filter((p) => p.rate !== null);
        const main = billable[0]?.currency ?? 'USD';
        setCurrency(main);
        setChosen(billable.filter((p) => p.currency === main).map((p) => p.projectId));
      })
      .catch((err) => setError(errorText(err, 'Could not load the hours.')));
  }, [api, client, from, to]);

  const selected = projects?.filter((p) => chosen.includes(p.projectId)) ?? [];
  const subtotal = selected.reduce((t, p) => t + (p.amount ?? 0), 0);

  async function create() {
    setBusy(true);
    setError(undefined);
    const due = new Date(`${today}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + (Number(dueDays) || 0));
    try {
      const doc = await api<ClientDocumentDto>('/client-docs/from-hours', {
        method: 'POST',
        body: { companyId: client, from, to, projectIds: chosen, currency, issueDate: today, dueDate: due.toISOString().slice(0, 10), taxRate: Number(taxRate) || 0, taxLabel, notes },
      });
      router.push(`/app/crm/invoices/${doc.id}`);
    } catch (err) {
      setError(errorText(err, 'Could not make the invoice.'));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Bill hours" description="Invoice a client for approved timesheet hours that haven’t been billed yet, at each project’s hourly rate." />
      <CrmTabs />
      <p className="mb-4 text-sm">
        <Link href="/app/crm/invoices" className="text-brand-700 underline">
          Back to quotes and invoices
        </Link>
      </p>
      <div className="space-y-5 rounded-3xl bg-white p-5 shadow-sm" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Labelled label="Client">
            <select value={client} onChange={(e) => setClient(e.target.value)} className={input}>
              <option value="">Choose a client</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Hours from">
            <input type="date" value={from} max={to} onChange={(e) => setRange({ from: e.target.value, to })} className={input} />
          </Labelled>
          <Labelled label="To">
            <input type="date" value={to} min={from} onChange={(e) => setRange({ from, to: e.target.value })} className={input} />
          </Labelled>
        </div>

        {client &&
          (!projects ? (
            <p className="text-sm text-gray-500">Loading hours…</p>
          ) : projects.length === 0 ? (
            <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
              No approved, unbilled hours for this client in these dates. Hours count once the person’s weekly timesheet is approved.
            </p>
          ) : (
            <fieldset>
              <legend className="text-sm font-medium text-gray-700">Projects</legend>
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {projects.map((p) => {
                  const blocked = p.rate === null ? 'No hourly rate yet' : p.currency !== currency ? `Billed in ${p.currency}` : null;
                  return (
                    <li key={p.projectId} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <input
                        type="checkbox"
                        id={`p-${p.projectId}`}
                        checked={chosen.includes(p.projectId)}
                        disabled={!!blocked}
                        onChange={(e) => setChosen(e.target.checked ? [...chosen, p.projectId] : chosen.filter((x) => x !== p.projectId))}
                      />
                      <label htmlFor={`p-${p.projectId}`} className="flex-1 font-medium">
                        {p.projectName}
                        <span className="block text-xs font-normal text-gray-500">
                          {p.hours} hours from {p.entries} {p.entries === 1 ? 'entry' : 'entries'}
                          {p.rate !== null && ` at ${docMoney(p.rate, p.currency ?? '')} an hour`}
                        </span>
                      </label>
                      {blocked ? (
                        <span className="text-xs text-amber-700">
                          {blocked}
                          {p.rate === null && (
                            <>
                              {' '}
                              ·{' '}
                              <Link href="/app/reports/costs" className="underline">
                                set it
                              </Link>
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="tabular-nums">{docMoney(p.amount ?? 0, p.currency ?? '')}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}

        {selected.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <Labelled label="Currency">
                <select
                  value={currency}
                  onChange={(e) => {
                    const c = e.target.value as Currency;
                    setCurrency(c);
                    setChosen(chosen.filter((id) => projects?.find((p) => p.projectId === id)?.currency === c));
                  }}
                  className={input}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Labelled>
              <Labelled label="Payment due in (days)">
                <input inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} className={input} />
              </Labelled>
              <Labelled label="Tax label">
                <input value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} placeholder="e.g. Sales tax" maxLength={80} className={input} />
              </Labelled>
              <Labelled label="Tax %">
                <input inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={input} />
              </Labelled>
            </div>
            <Labelled label="Notes for the client (payment details, terms)">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} className={input} />
            </Labelled>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={btn.primary} disabled={busy || chosen.length === 0} onClick={() => void create()}>
                {busy ? 'Making the invoice…' : `Make a draft invoice for ${docMoney(subtotal, currency)}`}
              </button>
              <span className="text-xs text-gray-500">Plus tax. These hours won’t show here again unless the invoice is voided or deleted.</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
