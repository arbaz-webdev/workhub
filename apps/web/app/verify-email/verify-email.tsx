'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/form';
import { api, ApiError } from '@/lib/api';

type State = { status: 'checking' } | { status: 'done' } | { status: 'failed'; message: string };

export function VerifyEmail({ token }: { token?: string }) {
  const [state, setState] = useState<State>(
    token ? { status: 'checking' } : { status: 'failed', message: 'This link is missing its code.' },
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
          message: err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.',
        }),
      );
  }, [token]);

  const title =
    state.status === 'checking' ? 'Confirming your email…' : state.status === 'done' ? 'Email confirmed' : 'Link not valid';

  return (
    <AuthCard
      title={title}
      subtitle={
        state.status === 'done'
          ? 'Thanks. Your account is fully set up.'
          : state.status === 'failed'
            ? state.message
            : 'This takes a second.'
      }
      footer={
        <Link href="/app" className="font-medium text-brand-700 hover:underline">
          Go to your workspace
        </Link>
      }
    >
      {state.status === 'failed' && (
        <p className="text-sm text-gray-600">
          Sign in and use <strong>Resend email</strong> on the banner at the top of your workspace to get a new link.
        </p>
      )}
    </AuthCard>
  );
}
