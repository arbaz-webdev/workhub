'use client';

import { PLAN_INFO, PROVINCE_LABELS, type InvoiceDto, type SubscriptionDto } from '@workhub/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { pkr } from '@/components/settings/tabs';
import { Alert, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';

const date = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const api = useWorkspaceApi();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDto>();
  const [sub, setSub] = useState<SubscriptionDto>();
  const [error, setError] = useState<string>();
  const [paying, setPaying] = useState(false);

  const load = useCallback(() => {
    api<InvoiceDto>(`/billing/invoices/${id}`)
      .then(setInvoice)
      .catch(() => setError('This invoice isn’t available.'));
    api<SubscriptionDto>('/billing/subscription')
      .then(setSub)
      .catch(() => {});
  }, [api, id]);
  useEffect(load, [load]);

  async function payOnline() {
    setPaying(true);
    try {
      const { url } = await api<{ url: string }>(`/billing/invoices/${id}/pay`, { method: 'POST' });
      // Our own pages stay in the app; a gateway's checkout is a full page load.
      if (url.startsWith('/')) router.push(url);
      else window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment.');
      setPaying(false);
    }
  }

  if (!invoice) return error ? <Alert>{error}</Alert> : <p className="text-sm text-gray-500">Loading…</p>;
  const open = invoice.status === 'open';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/app/settings/billing" className="text-sm text-brand-700 hover:underline">
          ← Plan and billing
        </Link>
        <button type="button" className={`${btn.secondary} ms-auto`} onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      <div className="space-y-4 print:hidden">
        {error && <Alert>{error}</Alert>}
        {invoice.status === 'paid' && <Alert kind="success">Paid on {date(invoice.paidAt!)}. Thank you.</Alert>}
        {invoice.status === 'pending_review' && <Alert kind="success">We’ve got your transfer details and will confirm within one working day. You’ll get an email.</Alert>}
        {open && invoice.reviewNote && <Alert>{invoice.reviewNote}</Alert>}
        {invoice.status === 'void' && <Alert>This invoice was replaced by a newer one.</Alert>}
      </div>

      <article className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm print:mt-0 print:border-0 print:p-0 print:shadow-none sm:p-8" aria-label={`Invoice ${invoice.number}`}>
        <header className="flex flex-wrap justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-lg font-semibold">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">W</span>
              {invoice.seller.name}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {invoice.seller.address && (
                <>
                  {invoice.seller.address}
                  <br />
                </>
              )}
              {invoice.seller.ntn && (
                <>
                  NTN {invoice.seller.ntn}
                  <br />
                </>
              )}
              {invoice.seller.email}
            </p>
          </div>
          <div className="text-end">
            <h1 className="text-2xl font-semibold">Invoice</h1>
            <p className="text-sm text-gray-600">{invoice.number}</p>
            <p className="mt-2 text-sm text-gray-600">Issued {date(invoice.issuedAt)}</p>
            <p className="text-sm text-gray-600">Due {date(invoice.dueAt)}</p>
          </div>
        </header>

        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bill to</h2>
          <p className="mt-1 text-sm text-gray-900">
            <span className="font-medium">{invoice.billTo.name}</span>
            <br />
            {invoice.billTo.address && (
              <>
                {invoice.billTo.address}
                <br />
              </>
            )}
            {PROVINCE_LABELS[invoice.billTo.province]}
            <br />
            {invoice.billTo.ntn && (
              <>
                NTN/CNIC {invoice.billTo.ntn}
                <br />
              </>
            )}
            {invoice.billTo.email}
          </p>
        </section>

        <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="border-b border-gray-200 text-start text-xs text-gray-500">
            <tr>
              <th className="py-2">Description</th>
              <th className="py-2 ps-4 text-end">Qty</th>
              <th className="py-2 ps-4 text-end">Price</th>
              <th className="py-2 ps-4 text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100 align-top">
              <td className="py-3 pe-3">
                WorkHub {PLAN_INFO[invoice.plan].name}, {invoice.billingCycle === 'annual' ? 'yearly' : 'monthly'} ({invoice.billTo.workspace})
                <span className="block text-xs text-gray-500">
                  {date(invoice.periodStart)} to {date(invoice.periodEnd)}
                  {invoice.billingCycle === 'annual' && ` · ${invoice.months} months for the price of ${invoice.subtotal / (invoice.unitPrice * invoice.seats)}`}
                </span>
              </td>
              <td className="whitespace-nowrap py-3 ps-4 text-end tabular-nums">{invoice.seats} people</td>
              <td className="whitespace-nowrap py-3 ps-4 text-end tabular-nums">{pkr(invoice.unitPrice)} / month</td>
              <td className="whitespace-nowrap py-3 ps-4 text-end tabular-nums">{pkr(invoice.subtotal)}</td>
            </tr>
          </tbody>
          <tfoot className="text-sm">
            <tr>
              <td colSpan={3} className="pt-3 text-end text-gray-600">
                Subtotal
              </td>
              <td className="whitespace-nowrap pt-3 ps-4 text-end tabular-nums">{pkr(invoice.subtotal)}</td>
            </tr>
            {invoice.discountAmount > 0 && (
              <tr>
                <td colSpan={3} className="pt-1 text-end text-gray-600">
                  {invoice.discountLabel ?? `Discount (${invoice.discountPercent}%)`}
                </td>
                <td className="whitespace-nowrap pt-1 ps-4 text-end tabular-nums">−{pkr(invoice.discountAmount)}</td>
              </tr>
            )}
            {invoice.taxLabel && (
              <tr>
                <td colSpan={3} className="pt-1 text-end text-gray-600">
                  {invoice.taxLabel}
                </td>
                <td className="whitespace-nowrap pt-1 ps-4 text-end tabular-nums">{pkr(invoice.taxAmount)}</td>
              </tr>
            )}
            <tr className="text-base font-semibold">
              <td colSpan={3} className="pt-2 text-end">
                Total
              </td>
              <td className="whitespace-nowrap pt-2 ps-4 text-end tabular-nums">{pkr(invoice.total)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
        {invoice.status === 'paid' && <p className="mt-6 text-sm font-medium text-emerald-700">Paid {date(invoice.paidAt!)}</p>}
      </article>

      {open && sub && (
        <div className="mt-6 grid gap-4 print:hidden md:grid-cols-2">
          {sub.payments.online && (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Pay online</h2>
              <p className="mt-1 text-sm text-gray-600">Card, JazzCash or Easypaisa.{sub.payments.onlineLabel && ` ${sub.payments.onlineLabel}.`}</p>
              <button type="button" className={`${btn.primary} mt-4`} disabled={paying} onClick={() => void payOnline()}>
                {paying ? 'Opening…' : `Pay ${pkr(invoice.total)}`}
              </button>
            </section>
          )}
          {sub.payments.bankTransfer && invoice.billingCycle === 'annual' && <BankTransfer invoice={invoice} bank={sub.payments.bankTransfer} onSent={load} />}
          {!sub.payments.online && invoice.billingCycle === 'monthly' && (
            <Alert>Online payment isn’t available yet. Choose a yearly plan to pay by bank transfer, or contact us.</Alert>
          )}
        </div>
      )}
    </>
  );
}

function BankTransfer({ invoice, bank, onSent }: { invoice: InvoiceDto; bank: NonNullable<SubscriptionDto['payments']['bankTransfer']>; onSent: () => void }) {
  const api = useWorkspaceApi();
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError('Attach the receipt.');
    const form = new FormData();
    form.set('reference', reference);
    form.set('proof', file);
    setSending(true);
    try {
      await api(`/billing/invoices/${invoice.id}/bank-transfer`, { method: 'POST', body: form });
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : 'Could not send it.');
      setSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Pay by bank transfer (IBFT)</h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-gray-500">Bank</dt>
        <dd>{bank.bank}</dd>
        <dt className="text-gray-500">Title</dt>
        <dd>{bank.accountTitle}</dd>
        <dt className="text-gray-500">IBAN</dt>
        <dd className="font-mono">{bank.iban}</dd>
        <dt className="text-gray-500">Amount</dt>
        <dd className="font-medium">{pkr(invoice.total)}</dd>
        <dt className="text-gray-500">Reference</dt>
        <dd>{invoice.number}</dd>
      </dl>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {error && <Alert>{error}</Alert>}
        <label className="block text-sm">
          <span className="text-gray-700">Transaction reference from your bank</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} required minLength={3} maxLength={100} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Receipt (screenshot or PDF)</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required className="mt-1 block text-sm file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-700" />
        </label>
        <button type="submit" className={btn.secondary} disabled={sending}>
          {sending ? 'Sending…' : 'I’ve paid: send for confirmation'}
        </button>
      </form>
    </section>
  );
}
