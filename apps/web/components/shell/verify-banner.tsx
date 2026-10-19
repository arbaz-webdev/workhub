'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

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
    <div role="status" className="border-b border-amber-200 bg-amber-50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm text-amber-900 lg:px-8">
        <span>
          Please confirm your email. We sent a link to <strong>{email}</strong>.
        </span>
        {state === 'sent' ? (
          <span className="font-medium">New link sent.</span>
        ) : (
          <button
            onClick={resend}
            disabled={state === 'sending'}
            className="font-semibold underline underline-offset-2 disabled:opacity-60"
          >
            {state === 'error' ? 'Could not send. Try again' : 'Resend email'}
          </button>
        )}
      </div>
    </div>
  );
}
