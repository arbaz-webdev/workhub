'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/form';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

type State = { status: 'checking' } | { status: 'done' } | { status: 'failed'; message: string };

export function VerifyEmail({ token }: { token?: string }) {
  const t = useT();
  const [state, setState] = useState<State>(
    token ? { status: 'checking' } : { status: 'failed', message: t('verifyEmail.missing') },
  );
  const sent = useRef(false);

  useEffect(() => {
    // Guard against React running effects twice in development: tokens are single-use.
    if (!token || sent.current) return;
    sent.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => setState({ status: 'done' }))
      .catch((err) =>
        setState({
          status: 'failed',
          message: err instanceof ApiError ? err.message : t('auth.network'),
        }),
      );
  }, [token, t]);

  const title =
    state.status === 'checking' ? t('verifyEmail.checking') : state.status === 'done' ? t('verifyEmail.done') : t('verifyEmail.invalid');

  const [resendBefore, resendAfter] = t('verifyEmail.resendHint').split('{button}');

  return (
    <AuthCard
      title={title}
      subtitle={
        state.status === 'done'
          ? t('verifyEmail.doneHint')
          : state.status === 'failed'
            ? state.message
            : t('common.aSecond')
      }
      footer={
        <Link href="/app" className="font-medium text-brand-700 hover:underline">
          {t('verifyEmail.go')}
        </Link>
      }
    >
      {state.status === 'failed' && (
        <p className="text-sm text-gray-600">
          {resendBefore}
          <strong>{t('verify.resend')}</strong>
          {resendAfter}
        </p>
      )}
    </AuthCard>
  );
}
