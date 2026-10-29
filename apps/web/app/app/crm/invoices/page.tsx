'use client';

import type { ClientDocKind, ClientDocSummaryDto } from '@workhub/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DocStatus, docMoney } from '@/components/crm/client-docs';
import { CrmTabs } from '@/components/crm/shared';
import { Alert, PageHeader, btn } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

/** Quotes and invoices to clients. */
export default function ClientDocsPage() {
  const api = useWorkspaceApi();
  const [kind, setKind] = useState<ClientDocKind>('invoice');
  const [docs, setDocs] = useState<ClientDocSummaryDto[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setDocs(undefined);
    api<ClientDocSummaryDto[]>(`/client-docs?kind=${kind}`)
      .then(setDocs)
      .catch(() => setError('Could not load them.'));
  }, [api, kind]);

  const unpaid = docs?.filter((d) => d.kind === 'invoice' && d.status === 'sent') ?? [];
  const owed = new Map<string, number>();
  for (const d of unpaid) owed.set(d.currency, (owed.get(d.currency) ?? 0) + d.total);

  return (
    <>
      <PageHeader
        title="CRM"
        description="Quotes and invoices to your clients, including invoices for approved timesheet hours."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/crm/invoices/hours" className={btn.primary}>
              Bill hours
            </Link>
            <Link href={`/app/crm/invoices/new?kind=${kind}`} className={btn.secondary}>
              New {kind}
            </Link>
          </div>
        }
      />
      <CrmTabs />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-gray-300 p-0.5 text-sm" role="radiogroup" aria-label="Show">
          {(['invoice', 'quote'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`rounded-md px-3 py-1 font-medium ${kind === k ? 'bg-brand-50 text-brand-700' : 'text-gray-600'}`}>
              {k === 'invoice' ? 'Invoices' : 'Quotes'}
            </button>
          ))}
        </div>
        {kind === 'invoice' && owed.size > 0 && (
          <p className="text-sm text-gray-700">
            Waiting to be paid: <span className="font-semibold tabular-nums">{[...owed].map(([c, v]) => docMoney(v, c)).join(' · ')}</span>
          </p>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {!docs ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-600">
          {kind === 'invoice' ? (
            <>
              No invoices yet. <Link href="/app/crm/invoices/hours" className="text-brand-700 underline">Bill a client’s approved hours</Link>, or write one by hand.
            </>
          ) : (
            'No quotes yet. Send one before the work starts; when the client accepts, it becomes an invoice in one click.'
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">{kind === 'quote' ? 'Valid until' : 'Due'}</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/app/crm/invoices/${d.id}`} className="font-medium text-brand-700 hover:underline">
                      {d.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{d.company.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{date(d.issueDate)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{date(d.dueDate)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{docMoney(d.total, d.currency)}</td>
                  <td className="px-4 py-2.5">
                    <DocStatus status={d.status} overdue={d.overdue} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
