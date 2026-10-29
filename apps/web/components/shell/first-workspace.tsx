'use client';

import { createWorkspaceSchema, type WorkspaceDto } from '@workhub/shared';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { btn, input } from '@/components/ui';
import { useT } from '@/lib/i18n';

/** Shown to someone signed in with no workspace yet (e.g. a new Google user). */
export function FirstWorkspace({ name, onCreated }: { name: string; onCreated: (w: WorkspaceDto) => void }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = createWorkspaceSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      onCreated(await api<WorkspaceDto>('/workspaces', { method: 'POST', body: parsed.data }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('first.failed'));
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">{t('first.welcome', { name: name.split(' ')[0]! })}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('first.hint')}
        </p>
        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">{t('signUp.companyName')}</span>
            <input name="name" autoComplete="organization" className={`mt-1 ${input}`} />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className={`w-full ${btn.primary} py-2.5`}>
            {pending ? t('auth.wait') : t('signUp.submitCreate')}
          </button>
        </form>
      </div>
    </main>
  );
}
