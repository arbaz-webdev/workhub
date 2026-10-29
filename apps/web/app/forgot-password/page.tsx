'use client';

import { forgotPasswordSchema } from '@workhub/shared';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard, Field, FormError, issuesToFields, SubmitButton } from '@/components/form';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t('auth.network'));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title={sentTo ? t('forgot.checkEmail') : t('forgot.title')}
      subtitle={
        sentTo
          ? t('forgot.sent', { email: sentTo })
          : t('forgot.subtitle')
      }
      footer={
        <Link href="/sign-in" className="font-medium text-brand-700 hover:underline">
          {t('twoFactor.back')}
        </Link>
      }
    >
      {!sentTo && (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError message={error} />
          <Field label={t('auth.email')} name="email" type="email" autoComplete="email" error={fields.email} />
          <SubmitButton pending={pending}>{t('forgot.submit')}</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
