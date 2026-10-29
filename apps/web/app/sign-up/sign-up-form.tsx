'use client';

import { signUpSchema, type WorkspaceDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthCard, Field, FormError, issuesToFields, SubmitButton } from '@/components/form';
import { GoogleButton } from '@/components/google-button';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { LanguageSwitch } from '@/components/language-switch';
import { safeNext, storeWorkspace } from '@/lib/workspace';

export function SignUpForm({ next: rawNext, email }: { next?: string; email?: string }) {
  const router = useRouter();
  const next = safeNext(rawNext);
  // Someone coming from an invitation joins that workspace instead of creating one.
  const joining = next?.startsWith('/invite/') ?? false;
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = signUpSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setFields(issuesToFields(parsed.error.issues));
      return;
    }
    if (!joining && !parsed.data.workspaceName) {
      setFields({ workspaceName: t('signUp.companyRequired') });
      return;
    }
    setFields({});
    setError(undefined);
    setPending(true);
    try {
      const res = await api<{ workspace: WorkspaceDto | null }>('/auth/sign-up', { method: 'POST', body: parsed.data });
      if (res.workspace) storeWorkspace(res.workspace.id);
      router.push(next ?? '/app');
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fieldErrors);
        setError(err.message === 'Validation failed' ? undefined : err.message);
      } else {
        setError(t('auth.network'));
      }
      setPending(false);
    }
  }

  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in';

  return (
    <AuthCard
      title={joining ? t('signUp.titleJoin') : t('signUp.titleCreate')}
      subtitle={joining ? t('signUp.subtitleJoin') : t('signUp.subtitleCreate')}
      footer={
        <>
          {t('signUp.haveAccount')}{' '}
          <Link href={signInHref} className="font-medium text-brand-700 hover:underline">
            {t('signUp.signIn')}
          </Link>
          <LanguageSwitch />
        </>
      }
    >
      {!joining && <GoogleButton />}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Field label={t('signUp.yourName')} name="name" autoComplete="name" error={fields.name} />
        {!joining && (
          <Field label={t('signUp.companyName')} name="workspaceName" autoComplete="organization" error={fields.workspaceName} />
        )}
        <Field label={t('signUp.workEmail')} name="email" type="email" autoComplete="email" defaultValue={email} error={fields.email} />
        <Field
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="new-password"
          error={fields.password}
          hint={t('signUp.passwordHint')}
        />
        <SubmitButton pending={pending} pendingLabel={t('auth.wait')}>
          {joining ? t('signUp.submitJoin') : t('signUp.submitCreate')}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
