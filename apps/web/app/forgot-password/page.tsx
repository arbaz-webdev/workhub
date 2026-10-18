'use client';

import { forgotPasswordSchema } from '@workhub/shared';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard, Field, FormError, issuesToFields, SubmitButton } from '@/components/form';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setFields(issuesToFields(parsed.error.issues));
      return;
    }
    setFields({});
    setError(undefined);
    setPending(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: parsed.data });
      setSentTo(parsed.data.email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title={sentTo ? 'Check your email' : 'Reset your password'}
      subtitle={
        sentTo
          ? `If ${sentTo} has a WorkHub account, we've sent a link to choose a new password. It expires in 30 minutes.`
          : "Enter your email and we'll send you a link to choose a new password."
      }
      footer={
        <Link href="/sign-in" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {!sentTo && (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError message={error} />
          <Field label="Email" name="email" type="email" autoComplete="email" error={fields.email} />
          <SubmitButton pending={pending}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
