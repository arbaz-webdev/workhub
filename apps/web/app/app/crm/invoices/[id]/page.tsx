'use client';

import type { ClientDocStatus, ClientDocumentDto } from '@workhub/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DocEditor, DocStatus, KIND_LABEL, docMoney } from '@/components/crm/client-docs';
import { errorText } from '@/components/crm/shared';
import { Alert, btn } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null);

/** The next steps offered for each status (the server checks them too). */
const ACTIONS: Record<string, { to: ClientDocStatus; label: string; style: keyof typeof btn }[]> = {
  'quote:draft': [{ to: 'sent', label: 'Mark as sent', style: 'primary' }],
  'quote:sent': [
    { to: 'accepted', label: 'Client accepted', style: 'primary' },
    { to: 'declined', label: 'Client declined', style: 'secondary' },
    { to: 'draft', label: 'Back to draft', style: 'ghost' },
  ],
  'quote:accepted': [{ to: 'sent', label: 'Undo acceptance', style: 'ghost' }],
  'quote:declined': [{ to: 'sent', label: 'Undo', style: 'ghost' }],
  'invoice:draft': [{ to: 'sent', label: 'Mark as sent', style: 'primary' }],
  'invoice:sent': [
    { to: 'paid', label: 'Mark as paid', style: 'primary' },
    { to: 'draft', label: 'Back to draft', style: 'ghost' },
    { to: 'void', label: 'Void', style: 'danger' },
  ],
  'invoice:paid': [{ to: 'sent', label: 'Undo payment', style: 'ghost' }],
};

export default function ClientDocPage() {
  const { id } = useParams<{ id: string }>();
  const api = useWorkspaceApi();
  const router = useRouter();
  const [doc, setDoc] = useState<ClientDocumentDto>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<ClientDocumentDto>(`/client-docs/${id}`)
      .then(setDoc)
      .catch((err) => setError(errorText(err, 'Could not load it.')));
  }, [api, id]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err, 'That didn’t work.'));
    }
  }

  const move = (to: ClientDocStatus) =>
    act(async () => {
      if (to === 'void' && !confirm('Void this invoice? It stays on record, and any timesheet hours on it can be billed again.')) return;
      setDoc(await api<ClientDocumentDto>(`/client-docs/${id}/status`, { method: 'POST', body: { status: to } }));
    });

  if (!doc) return error ? <Alert>{error}</Alert> : <p className="text-sm text-gray-500">Loading…</p>;
  const label = KIND_LABEL[doc.kind];

  if (editing) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">
          Edit {label.toLowerCase()} {doc.number}
        </h1>
        <DocEditor
          kind={doc.kind}
          initial={doc}
          onSaved={(d) => {
            setDoc(d);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/app/crm/invoices" className="text-sm text-brand-700 underline">
          Quotes and invoices
        </Link>
        <span className="ml-2">
          <DocStatus status={doc.status} overdue={doc.overdue} />
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {doc.status === 'draft' && (
            <button type="button" className={btn.secondary} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {(ACTIONS[`${doc.kind}:${doc.status}`] ?? []).map((a) => (
            <button key={a.to} type="button" className={btn[a.style]} onClick={() => void move(a.to)}>
              {a.label}
            </button>
          ))}
          {doc.kind === 'quote' && doc.status === 'accepted' && !doc.invoiceId && (
            <button
              type="button"
              className={btn.primary}
              onClick={() => void act(async () => router.push(`/app/crm/invoices/${(await api<ClientDocumentDto>(`/client-docs/${id}/invoice`, { method: 'POST' })).id}`))}
            >
              Make the invoice
            </button>
          )}
          <button type="button" className={btn.secondary} onClick={() => window.print()}>
            Print or save PDF
          </button>
          {doc.status === 'draft' && (
            <button
              type="button"
              className={btn.danger}
              onClick={() =>
                void act(async () => {
                  if (!confirm(`Delete draft ${doc.number}?`)) return;
                  await api(`/client-docs/${id}`, { method: 'DELETE' });
                  router.push('/app/crm/invoices');
                })
              }
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mb-4 print:hidden">
          <Alert>{error}</Alert>
        </div>
      )}
      {(doc.invoiceId || doc.quoteId || doc.billedHours > 0) && (
        <p className="mb-4 text-sm text-gray-600 print:hidden">
          {doc.invoiceId && (
            <Link href={`/app/crm/invoices/${doc.invoiceId}`} className="text-brand-700 underline">
              See the invoice made from this quote
            </Link>
          )}
          {doc.quoteId && (
            <Link href={`/app/crm/invoices/${doc.quoteId}`} className="text-brand-700 underline">
              Made from a quote
            </Link>
          )}
          {doc.billedHours > 0 && ` Bills ${doc.billedHours} approved timesheet hours.`}
        </p>
      )}

      <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none sm:p-8" aria-label={`${label} ${doc.number}`}>
        <header className="flex flex-wrap justify-between gap-6">
          <div>
            <p className="text-lg font-semibold">{doc.from.name}</p>
            {doc.from.address && <p className="whitespace-pre-line text-sm text-gray-600">{doc.from.address}</p>}
            {doc.from.ntn && <p className="text-sm text-gray-600">NTN {doc.from.ntn}</p>}
            {doc.from.email && <p className="text-sm text-gray-600">{doc.from.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-tight">{label}</p>
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
    </>
  );
}
