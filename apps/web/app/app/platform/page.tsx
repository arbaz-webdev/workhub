'use client';

import { PLAN_INFO, type TransferReviewDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { pkr } from '@/components/settings/tabs';
import { Alert, PageHeader, btn, input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/** WorkHub staff only: bank transfers to confirm against the bank statement. */
export default function PlatformPage() {
  const [list, setList] = useState<TransferReviewDto[]>();
  const [forbidden, setForbidden] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ kind: 'error' | 'success'; text: string }>();

  const load = useCallback(() => {
    api<TransferReviewDto[]>('/platform/transfers')
      .then(setList)
      .catch((err) => (err instanceof ApiError && err.status === 403 ? setForbidden(true) : setResult({ kind: 'error', text: 'Could not load transfers.' })));
  }, []);
  useEffect(load, [load]);

  async function review(t: TransferReviewDto, approve: boolean) {
    if (approve && !confirm(`Confirm ${pkr(t.total)} from ${t.workspaceName} arrived in the account? Their plan starts now.`)) return;
    try {
      await api(`/platform/transfers/${t.id}/review`, { method: 'POST', body: { approve, note: notes[t.id] || undefined } });
      setResult({ kind: 'success', text: `${t.number} ${approve ? 'confirmed' : 'sent back'}.` });
      load();
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not save the review.' });
    }
  }

  if (forbidden) {
    return (
      <>
        <PageHeader title="Not available" />
        <Alert>This page is for WorkHub staff.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Bank transfers to confirm" description="Check each against the bank statement before confirming. Confirming starts the customer’s plan." />
      <div className="space-y-4" aria-live="polite">
        {result && <Alert kind={result.kind}>{result.text}</Alert>}
        {!list ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : list.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">Nothing waiting.</p>
        ) : (
          list.map((t) => (
            <section key={t.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  {t.workspaceName} <span className="font-normal text-gray-500">· {t.number}</span>
                </h2>
                <span className="text-lg font-semibold tabular-nums">{pkr(t.total)}</span>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {PLAN_INFO[t.plan].name}, {t.billingCycle}, {t.seats} people · billed to {t.billTo.name} ({t.billTo.email})
              </p>
              <p className="mt-1 text-sm">
                Reference <span className="font-mono">{t.transferReference}</span> · sent {t.transferSubmittedAt && new Date(t.transferSubmittedAt).toLocaleString()}
                {t.proofUrl && (
                  <>
                    {' · '}
                    <a href={`/api${t.proofUrl}`} className="text-brand-700 underline">
                      Download receipt
                    </a>
                  </>
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input value={notes[t.id] ?? ''} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} placeholder="Note to the customer if sending back" aria-label="Note" maxLength={500} className={`${input} sm:!w-80`} />
                <button type="button" className={btn.primary} onClick={() => void review(t, true)}>
                  Confirm payment
                </button>
                <button type="button" className={btn.danger} onClick={() => void review(t, false)}>
                  Send back
                </button>
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}
