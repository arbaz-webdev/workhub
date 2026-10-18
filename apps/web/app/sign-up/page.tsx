'use client';

import { signUpSchema } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthCard, Field, FormError, issuesToFields, SubmitButton } from '@/components/form';
import { api, ApiError } from '@/lib/api';

export default function SignUpPage() {
  const router = useRouter();
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
    setFields({});
    setError(undefined);
    setPending(true);
    try {
      const res = await api<{ workspace: { id: string } }>('/auth/sign-up', { method: 'POST', body: parsed.data });
      localStorage.setItem('wh_workspace', res.workspace.id);
      router.push('/app');
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

  return (
    <AuthCard
      title="Create your workspace"
      subtitle="Free for teams of up to 10. No card needed."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Field label="Your name" name="name" autoComplete="name" error={fields.name} />
        <Field label="Company name" name="workspaceName" autoComplete="organization" error={fields.workspaceName} />
        <Field label="Work email" name="email" type="email" autoComplete="email" error={fields.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          error={fields.password}
          hint="At least 10 characters."
        />
        <SubmitButton pending={pending}>Create workspace</SubmitButton>
      </form>
    </AuthCard>
  );
}
