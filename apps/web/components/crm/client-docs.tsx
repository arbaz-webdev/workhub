'use client';

import {
  CLIENT_DOC_STATUS_LABELS,
  CURRENCIES,
  documentTotals,
  type ClientDocKind,
  type ClientDocStatus,
  type ClientDocumentDto,
  type CompanyDto,
  type Currency,
} from '@workhub/shared';
import { useEffect, useState } from 'react';
import { Alert, btn, input } from '@/components/ui';
import { localToday } from '@/lib/time';
import { useWorkspaceApi } from '@/lib/workspace';
import { errorText, Labelled } from './shared';

/** Money on quotes and invoices: always two decimals. */
export function docMoney(value: number, currency: string) {
  return `${currency} ${value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const BADGE: Record<ClientDocStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-sky-50 text-sky-800',
  accepted: 'bg-emerald-50 text-emerald-800',
  declined: 'bg-gray-100 text-gray-500',
  paid: 'bg-emerald-50 text-emerald-800',
  void: 'bg-gray-100 text-gray-500 line-through',
};

export function DocStatus({ status, overdue }: { status: ClientDocStatus; overdue?: boolean }) {
  if (overdue) return <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span>;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[status]}`}>{CLIENT_DOC_STATUS_LABELS[status]}</span>;
}

export const KIND_LABEL: Record<ClientDocKind, string> = { quote: 'Quote', invoice: 'Invoice' };

type Line = { description: string; quantity: string; unitPrice: string; projectId: string | null };

const addDaysTo = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Creates or edits a quote or invoice. Totals update as you type, worked out as the server will. */
export function DocEditor({
  kind,
  initial,
  companyId,
  onSaved,
  onCancel,
}: {
  kind: ClientDocKind;
  initial?: ClientDocumentDto;
  companyId?: string;
  onSaved: (doc: ClientDocumentDto) => void;
  onCancel?: () => void;
}) {
  const api = useWorkspaceApi();
  const today = localToday();
  const [clients, setClients] = useState<CompanyDto[]>();
  const [client, setClient] = useState(initial?.company.id ?? companyId ?? '');
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? 'PKR');
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? addDaysTo(today, kind === 'quote' ? 30 : 14));
  const [taxLabel, setTaxLabel] = useState(initial?.taxLabel ?? '');
  const [taxRate, setTaxRate] = useState(String(initial?.taxRate ?? 0));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(
    initial?.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), projectId: l.projectId })) ?? [
      { description: '', quantity: '1', unitPrice: '', projectId: null },
    ],
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CompanyDto[]>('/companies')
      .then(setClients)
      .catch(() => setError('Could not load your clients.'));
  }, [api]);

  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  const parsed = lines.map((l) => ({ quantity: Math.round((num(l.quantity) || 0) * 100) / 100, unitPrice: Math.round((num(l.unitPrice) || 0) * 100) / 100 }));
  const totals = documentTotals(parsed, Number(taxRate) || 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const body = {
      ...(initial ? {} : { kind }),
      companyId: client,
      currency,
      issueDate,
      dueDate: dueDate || null,
      taxLabel,
      taxRate: Number(taxRate) || 0,
      notes,
      lines: lines.map((l) => ({ description: l.description, quantity: num(l.quantity), unitPrice: num(l.unitPrice), projectId: l.projectId })),
    };
    try {
      onSaved(await api<ClientDocumentDto>(initial ? `/client-docs/${initial.id}` : '/client-docs', { method: initial ? 'PATCH' : 'POST', body }));
    } catch (err) {
      setError(errorText(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5 rounded-3xl bg-white p-5 shadow-sm">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Labelled label="Client">
          <select value={client} onChange={(e) => setClient(e.target.value)} className={input} required>
            <option value="">Choose a client</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Currency">
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={input}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Date">
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={input} required />
        </Labelled>
        <Labelled label={kind === 'quote' ? 'Valid until' : 'Payment due'}>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} />
        </Labelled>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">Lines</legend>
        <div className="mt-2 space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-gray-100 p-2 sm:grid-cols-[1fr_6rem_8rem_8rem_auto] sm:items-center sm:border-0 sm:p-0">
              <input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="What it’s for" maxLength={500} className={`${input} col-span-2 sm:col-span-1`} />
              <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="Qty" className={`${input} text-right tabular-nums`} />
              <input aria-label={`Line ${i + 1} price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} placeholder="Price" className={`${input} text-right tabular-nums`} />
              <span className="self-center text-right text-sm tabular-nums text-gray-700">{docMoney(totals.amounts[i] ?? 0, currency)}</span>
              <button type="button" className={`${btn.ghost} justify-self-end`} aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" className={`${btn.secondary} mt-2`} onClick={() => setLines([...lines, { description: '', quantity: '1', unitPrice: '', projectId: null }])}>
          Add a line
        </button>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
        <Labelled label="Notes for the client (payment details, terms)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000} className={input} />
        </Labelled>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Labelled label="Tax label">
              <input value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} placeholder="e.g. Sales tax" maxLength={80} className={input} />
            </Labelled>
            <Labelled label="Tax %">
              <input inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={`${input} text-right`} />
            </Labelled>
          </div>
          <dl className="space-y-1 text-sm tabular-nums">
            <div className="flex justify-between">
              <dt className="text-gray-600">Subtotal</dt>
              <dd>{docMoney(totals.subtotal, currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Tax</dt>
              <dd>{docMoney(totals.taxAmount, currency)}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd>{docMoney(totals.total, currency)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btn.primary} disabled={busy || !client}>
          {busy ? 'Saving…' : initial ? 'Save changes' : `Save ${KIND_LABEL[kind].toLowerCase()} as draft`}
        </button>
        {onCancel && (
          <button type="button" className={btn.ghost} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null);

/** The quote or invoice as the client receives it; prints cleanly. */
export function DocPaper({ doc }: { doc: ClientDocumentDto }) {
  const label = KIND_LABEL[doc.kind];
  return (
    <article className="rounded-3xl bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none sm:p-8" aria-label={`${label} ${doc.number}`}>
      <header className="flex flex-wrap justify-between gap-6">
        <div>
          <p className="text-lg font-semibold">{doc.from.name}</p>
          {doc.from.address && <p className="whitespace-pre-line text-sm text-gray-600">{doc.from.address}</p>}
          {doc.from.ntn && <p className="text-sm text-gray-600">NTN {doc.from.ntn}</p>}
          {doc.from.email && <p className="text-sm text-gray-600">{doc.from.email}</p>}
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold tracking-tight">{label}</h1>
          <p className="text-sm text-gray-600">{doc.number}</p>
          <p className="mt-2 text-sm text-gray-600">Date: {date(doc.issueDate)}</p>
          {doc.dueDate && (
            <p className="text-sm text-gray-600">
              {doc.kind === 'quote' ? 'Valid until' : 'Payment due'}: {date(doc.dueDate)}
            </p>
          )}
        </div>
      </header>

      <section className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{doc.kind === 'quote' ? 'Prepared for' : 'Bill to'}</p>
        <p className="mt-1 font-medium">{doc.client.name}</p>
        {doc.client.address && <p className="whitespace-pre-line text-sm text-gray-600">{doc.client.address}</p>}
        {(doc.client.city || doc.client.country) && <p className="text-sm text-gray-600">{[doc.client.city, doc.client.country].filter(Boolean).join(', ')}</p>}
        {doc.client.email && <p className="text-sm text-gray-600">{doc.client.email}</p>}
      </section>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="border-b border-gray-300 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pl-4 text-right font-medium">Qty</th>
              <th className="py-2 pl-4 text-right font-medium">Price</th>
              <th className="py-2 pl-4 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 align-top">
                <td className="py-3 pr-3">{l.description}</td>
                <td className="whitespace-nowrap py-3 pl-4 text-right tabular-nums">{l.quantity}</td>
                <td className="whitespace-nowrap py-3 pl-4 text-right tabular-nums">{docMoney(l.unitPrice, doc.currency)}</td>
                <td className="whitespace-nowrap py-3 pl-4 text-right tabular-nums">{docMoney(l.amount, doc.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-right text-gray-600">
                Subtotal
              </td>
              <td className="whitespace-nowrap pt-3 pl-4 text-right tabular-nums">{docMoney(doc.subtotal, doc.currency)}</td>
            </tr>
            {doc.taxRate > 0 && (
              <tr>
                <td colSpan={3} className="pt-1 text-right text-gray-600">
                  {doc.taxLabel || 'Tax'} ({doc.taxRate}%)
                </td>
                <td className="whitespace-nowrap pt-1 pl-4 text-right tabular-nums">{docMoney(doc.taxAmount, doc.currency)}</td>
              </tr>
            )}
            <tr className="text-base font-semibold">
              <td colSpan={3} className="pt-2 text-right">
                Total
              </td>
              <td className="whitespace-nowrap pt-2 pl-4 text-right tabular-nums">{docMoney(doc.total, doc.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {doc.notes && <p className="mt-8 whitespace-pre-line border-t border-gray-100 pt-4 text-sm text-gray-700">{doc.notes}</p>}
      {doc.status === 'paid' && doc.paidAt && <p className="mt-6 text-sm font-semibold text-emerald-700">Paid {new Date(doc.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Thank you.</p>}
    </article>
  );
}
