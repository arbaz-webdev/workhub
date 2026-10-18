'use client';

import { resetPasswordSchema } from '@workhub/shared';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard, Field, FormError, SubmitButton } from '@/components/form';
import { api, ApiError } from '@/lib/api';

export function ResetPasswordForm({ token }: { token?: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>(
    token ? undefined : 'This link is missing its code. Request a new reset email.',
  );
  const [fieldError, setFieldError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      setFieldError("The two passwords don't match");
      return;
    }
    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues.find((i) => i.path[0] === 'password')?.message ?? 'Check your password');
      return;
    }
    setFieldError(undefined);
    setError(undefined);
    setPending(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: parsed.data });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title={done ? 'Password changed' : 'Choose a new password'}
      subtitle={
        done
          ? 'You have been signed out everywhere. Sign in with your new password.'
          : 'Use at least 10 characters. A short sentence is easy to remember and hard to guess.'
      }
      footer={
        <Link href={done ? '/sign-in' : '/forgot-password'} className="font-medium text-brand-700 hover:underline">
          {done ? 'Sign in' : 'Request a new link'}
        </Link>
      }
    >
      {!done && (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError message={error} />
          <Field label="New password" name="password" type="password" autoComplete="new-password" error={fieldError} />
          <Field label="Repeat new password" name="confirm" type="password" autoComplete="new-password" />
          <SubmitButton pending={pending || !token}>Change password</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
