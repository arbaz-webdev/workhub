'use client';

import type { InvoiceDto } from '@workhub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { pkr } from '@/components/settings/tabs';
import { Alert, btn, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';

export default function TestCheckoutPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TestCheckout />
    </Suspense>
  );
}

/** Stands in for a payment gateway on development and staging sites. No money moves. */
function TestCheckout() {
  const api = useWorkspaceApi();
  const router = useRouter();
  const id = useSearchParams().get('invoice') ?? '';
  const [invoice, setInvoice] = useState<InvoiceDto>();
  const [error, setError] = useState<string>();
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return setError('No invoice to pay.');
    api<InvoiceDto>(`/billing/invoices/${id}`)
      .then(setInvoice)
      .catch(() => setError('This invoice isn’t available.'));
  }, [api, id]);

  async function pay() {
    setPaying(true);
    try {
      await api(`/billing/invoices/${id}/test-pay`, { method: 'POST' });
      router.replace(`/app/settings/billing/invoices/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The test payment failed.');
      setPaying(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Test payment gateway</p>
        <p className="mt-1 text-sm text-amber-900">This site uses a pretend checkout for trying things out. No card is charged and no money moves.</p>
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        {invoice && (
          <>
            <p className="mt-5 text-sm text-gray-700">{invoice.number}</p>
            <p className="text-3xl font-semibold">{pkr(invoice.total)}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" className={btn.primary} disabled={paying || invoice.status !== 'open'} onClick={() => void pay()}>
                {paying ? 'Paying…' : 'Pay (test)'}
              </button>
              <button type="button" className={btn.ghost} onClick={() => router.replace(`/app/settings/billing/invoices/${id}`)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
