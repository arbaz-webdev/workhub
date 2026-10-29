'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

export function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const t = useT();

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
          {t('verify.please')} <strong>{email}</strong>
        </span>
        {state === 'sent' ? (
          <span className="font-medium">{t('verify.sent')}</span>
        ) : (
          <button
            onClick={resend}
            disabled={state === 'sending'}
            className="font-semibold underline underline-offset-2 disabled:opacity-60"
          >
            {state === 'error' ? t('verify.failed') : t('verify.resend')}
          </button>
        )}
      </div>
    </div>
  );
}
