'use client';

import { signUpSchema, type WorkspaceDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthCard, Field, FormError, issuesToFields, SubmitButton } from '@/components/form';
import { GoogleButton } from '@/components/google-button';
import { api, ApiError } from '@/lib/api';
import { safeNext, storeWorkspace } from '@/lib/workspace';

export function SignUpForm({ next: rawNext, email }: { next?: string; email?: string }) {
  const router = useRouter();
  const next = safeNext(rawNext);
  // Someone coming from an invitation joins that workspace instead of creating one.
  const joining = next?.startsWith('/invite/') ?? false;
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
      setFields({ workspaceName: 'Enter your company name' });
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
        setError('Could not reach the server. Check your connection and try again.');
      }
      setPending(false);
    }
  }

  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in';

  return (
    <AuthCard
      title={joining ? 'Create your account' : 'Create your workspace'}
      subtitle={joining ? "Then you'll join your team's workspace." : 'Free for teams of up to 10. No card needed.'}
      footer={
        <>
          Already have an account?{' '}
          <Link href={signInHref} className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {!joining && <GoogleButton />}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Field label="Your name" name="name" autoComplete="name" error={fields.name} />
        {!joining && (
          <Field label="Company name" name="workspaceName" autoComplete="organization" error={fields.workspaceName} />
        )}
        <Field label="Work email" name="email" type="email" autoComplete="email" defaultValue={email} error={fields.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          error={fields.password}
          hint="At least 10 characters."
        />
        <SubmitButton pending={pending}>{joining ? 'Create account' : 'Create workspace'}</SubmitButton>
      </form>
    </AuthCard>
  );
}
