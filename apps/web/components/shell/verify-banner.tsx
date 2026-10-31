'use client';

import { Check, Mail } from 'lucide-react';
import { useState } from 'react';
import { btn } from '@/components/ui';
import { api } from '@/lib/api';

/** A reminder to confirm the email address: a card in line with the page, not a strip across it. */
export function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function resend() {
    setState('sending');
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="w-full max-w-6xl px-4 pt-2 lg:px-8 print:hidden">
      <div role="status" className="flex animate-rise flex-wrap items-center gap-3 rounded-3xl bg-white p-2 pl-2.5 shadow-sm">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lime text-ink">
          <Mail size={16} strokeWidth={1.75} />
        </span>
        <p className="min-w-[12rem] flex-1 text-sm text-gray-600">
          Confirm your email: we sent a link to <span className="font-medium text-ink [overflow-wrap:anywhere]">{email}</span>
        </p>
        {state === 'sent' ? (
          <span className="ml-auto inline-flex shrink-0 animate-pop items-center gap-1.5 rounded-full bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">
            <Check aria-hidden="true" size={15} strokeWidth={2} />
            New link sent
          </span>
        ) : (
          <button type="button" onClick={resend} disabled={state === 'sending'} className={`${btn.primary} ml-auto shrink-0 !py-2`}>
            {state === 'sending' ? 'Sending…' : state === 'error' ? 'Could not send. Try again' : 'Resend email'}
          </button>
        )}
      </div>
    </div>
  );
}
