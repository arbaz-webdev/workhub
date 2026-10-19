'use client';

import { signInSchema } from '@workhub/shared';
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

export function SignInForm({ initialError, next: rawNext, email }: { initialError?: string; next?: string; email?: string }) {
  const router = useRouter();
  const next = safeNext(rawNext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError ? ERRORS[initialError] : undefined);
  const [fields, setFields] = useState<Record<string, string>>({});

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
      await api('/auth/sign-in', { method: 'POST', body: parsed.data });
      router.push(next ?? '/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
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
