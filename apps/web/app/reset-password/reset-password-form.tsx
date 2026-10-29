'use client';

import { resetPasswordSchema } from '@workhub/shared';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard, Field, FormError, SubmitButton } from '@/components/form';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

export function ResetPasswordForm({ token }: { token?: string }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>(
    token ? undefined : t('reset.missing'),
  );
  const [fieldError, setFieldError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      setFieldError(t('reset.mismatch'));
      return;
    }
    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues.find((i) => i.path[0] === 'password')?.message ?? t('reset.check'));
      return;
    }
    setFieldError(undefined);
    setError(undefined);
    setPending(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: parsed.data });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.network'));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title={done ? t('reset.done') : t('reset.title')}
      subtitle={
        done
          ? t('reset.doneHint')
          : t('reset.hint')
      }
      footer={
        <Link href={done ? '/sign-in' : '/forgot-password'} className="font-medium text-brand-700 hover:underline">
          {done ? t('signIn.submit') : t('reset.newLink')}
        </Link>
      }
    >
      {!done && (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError message={error} />
          <Field label={t('reset.password')} name="password" type="password" autoComplete="new-password" error={fieldError} />
          <Field label={t('reset.confirm')} name="confirm" type="password" autoComplete="new-password" />
          <SubmitButton pending={pending || !token}>{t('reset.submit')}</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
