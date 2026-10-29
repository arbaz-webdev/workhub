'use client';

import type { InvitePreviewDto, MeResponse, WorkspaceDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthCard, FormError, SubmitButton } from '@/components/form';
import { roleLabel } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { storeWorkspace } from '@/lib/workspace';

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [preview, setPreview] = useState<InvitePreviewDto | null>();
  const [me, setMe] = useState<MeResponse | null>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const next = `/invite/${token}`;

  useEffect(() => {
    api<InvitePreviewDto>(`/invitations/preview?token=${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch(() => setPreview(null));
    api<MeResponse>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, [token]);

  async function accept() {
    setPending(true);
    setError(undefined);
    try {
      const ws = await api<WorkspaceDto>('/invitations/accept', { method: 'POST', body: { token } });
      storeWorkspace(ws.id);
      router.push('/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.network'));
      setPending(false);
    }
  }

  if (preview === undefined || me === undefined) {
    return <AuthCard title={t('invite.opening')} subtitle={t('common.aSecond')} footer={null} />;
  }

  if (preview === null) {
    return (
      <AuthCard
        title={t('invite.invalid')}
        subtitle={t('invite.invalidHint')}
        footer={
          <Link href="/app" className="font-medium text-brand-700 hover:underline">
            {t('invite.goToWorkHub')}
          </Link>
        }
      />
    );
  }

  const title = t('invite.join', { workspace: preview.workspaceName });
  const subtitle = t('invite.invitedAs', { name: preview.inviterName ?? t('common.someone'), role: roleLabel(preview.role, locale).toLowerCase() });
  const wrongAccount = me && preview.email && me.user.email.toLowerCase() !== preview.email.toLowerCase();

  if (!me) {
    const qs = new URLSearchParams({ next });
    if (preview.email) qs.set('email', preview.email);
    return (
      <AuthCard title={title} subtitle={subtitle} footer={null}>
        <div className="space-y-3">
          <Link
            href={`/sign-up?${qs}`}
            className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-700"
          >
            {t('invite.createAndJoin')}
          </Link>
          <Link
            href={`/sign-in?${qs}`}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            {t('invite.haveAccount')}
          </Link>
          {preview.email && <p className="text-center text-xs text-gray-500">{t('invite.useEmail', { email: preview.email })}</p>}
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} subtitle={subtitle} footer={<span>{t('invite.signedInAs', { email: me.user.email })}</span>}>
      <div className="space-y-4">
        <FormError message={error} />
        {wrongAccount ? (
          <>
            <FormError message={t('invite.wrongAccount', { email: preview.email! })} />
            <button
              onClick={async () => {
                await api('/auth/sign-out', { method: 'POST' }).catch(() => {});
                router.push(`/sign-in?next=${encodeURIComponent(next)}&email=${encodeURIComponent(preview.email!)}`);
              }}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              {t('invite.switch')}
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void accept();
            }}
          >
            <SubmitButton pending={pending}>{title}</SubmitButton>
          </form>
        )}
      </div>
    </AuthCard>
  );
}
