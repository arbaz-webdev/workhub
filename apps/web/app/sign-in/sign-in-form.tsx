'use client';

import { signInSchema, type SignInResponse } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthCard, Field, FormError, issuesToFields, SubmitButton } from '@/components/form';
import { GoogleButton } from '@/components/google-button';
import { api, ApiError } from '@/lib/api';
import { safeNext } from '@/lib/workspace';

const ERRORS: Record<string, string> = {
  google: "Google sign-in didn't work. Please try again, or use your email and password.",
};

export function SignInForm({ initialError, next: rawNext, email, twoFactor }: { initialError?: string; next?: string; email?: string; twoFactor?: string }) {
  const router = useRouter();
  const next = safeNext(rawNext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError ? ERRORS[initialError] : undefined);
  const [fields, setFields] = useState<Record<string, string>>({});
  // After the password (or Google), the code from the authenticator app.
  const [challenge, setChallenge] = useState<string | null>(twoFactor ?? null);
  const [useRecovery, setUseRecovery] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = signInSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setFields(issuesToFields(parsed.error.issues));
      return;
    }
    setFields({});
    setError(undefined);
    setPending(true);
    try {
      const res = await api<SignInResponse>('/auth/sign-in', { method: 'POST', body: parsed.data });
      if (res.twoFactorRequired) {
        setChallenge(res.challenge);
        setPending(false);
        return;
      }
      router.push(next ?? '/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  async function onCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    if (code.replace(/\s/g, '').length < 6) return setFields({ code: useRecovery ? 'Enter a recovery code' : 'Enter the 6-digit code' });
    setFields({});
    setError(undefined);
    setPending(true);
    try {
      await api('/auth/2fa/verify', { method: 'POST', body: { challenge, code } });
      router.push(next ?? '/app');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && /expired/.test(err.message)) setChallenge(null);
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  if (challenge) {
    return (
      <AuthCard
        title="Two-factor sign-in"
        subtitle={useRecovery ? 'Enter one of the recovery codes you saved.' : 'Enter the 6-digit code from your authenticator app.'}
        footer={
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setChallenge(null)}>
            Back to sign in
          </button>
        }
      >
        <form onSubmit={onCode} noValidate className="space-y-4">
          <FormError message={error} />
          <label className="block">
            <span className="text-sm font-medium text-gray-700">{useRecovery ? 'Recovery code' : 'Code'}</span>
            <input
              key={useRecovery ? 'recovery' : 'code'}
              name="code"
              autoFocus
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              pattern={useRecovery ? undefined : '[0-9 ]*'}
              maxLength={useRecovery ? 11 : 7}
              placeholder={useRecovery ? 'xxxxx-xxxxx' : '123 456'}
              aria-invalid={fields.code ? true : undefined}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-center font-mono text-lg tracking-widest outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {fields.code && <span className="mt-1 block text-xs text-red-600">{fields.code}</span>}
          </label>
          <SubmitButton pending={pending}>Verify</SubmitButton>
          <button type="button" className="w-full text-center text-xs font-medium text-brand-700 hover:underline" onClick={() => setUseRecovery(!useRecovery)}>
            {useRecovery ? 'Use the code from my app' : 'Lost your phone? Use a recovery code'}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to your workspace."
      footer={
        <>
          New to WorkHub?{' '}
          <Link href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'} className="font-medium text-brand-700 hover:underline">
            Create a workspace
          </Link>
        </>
      }
    >
      <GoogleButton />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={email} error={fields.email} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" error={fields.password} />
        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-xs font-medium text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </div>
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
