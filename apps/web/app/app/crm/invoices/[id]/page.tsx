'use client';

import type { ClientDocStatus, ClientDocumentDto } from '@workhub/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DocEditor, DocPaper, DocStatus, KIND_LABEL } from '@/components/crm/client-docs';
import { errorText } from '@/components/crm/shared';
import { Alert, btn } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

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

      <DocPaper doc={doc} />
    </>
  );
}
