'use client';

import type { InvitePreviewDto, MeResponse, WorkspaceDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthCard, FormError, SubmitButton } from '@/components/form';
import { roleLabel } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { storeWorkspace } from '@/lib/workspace';

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
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
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.');
      setPending(false);
    }
  }

  if (preview === undefined || me === undefined) {
    return <AuthCard title="Opening your invitation…" subtitle="This takes a second." footer={null} />;
  }

  if (preview === null) {
    return (
      <AuthCard
        title="Invitation not valid"
        subtitle="This invitation was already used, cancelled, or has expired. Ask the person who invited you to send a new one."
        footer={
          <Link href="/app" className="font-medium text-brand-700 hover:underline">
            Go to WorkHub
          </Link>
        }
      />
    );
  }

  const title = `Join ${preview.workspaceName}`;
  const subtitle = `${preview.inviterName ?? 'Someone'} invited you as ${roleLabel(preview.role).toLowerCase()}.`;
  const wrongAccount = me && preview.email && me.user.email.toLowerCase() !== preview.email.toLowerCase();

  if (!me) {
    const qs = new URLSearchParams({ next });
    if (preview.email) qs.set('email', preview.email);
    return (
      <AuthCard title={title} subtitle={subtitle} footer={null}>
        <div className="space-y-3">
          <Link
            href={`/sign-up?${qs}`}
            className="block w-full rounded-lg bg-ink px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-black"
          >
            Create an account and join
          </Link>
          <Link
            href={`/sign-in?${qs}`}
            className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 text-center text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            I already have an account
          </Link>
          {preview.email && <p className="text-center text-xs text-gray-500">Use {preview.email}, the address the invitation was sent to.</p>}
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} subtitle={subtitle} footer={<span>Signed in as {me.user.email}</span>}>
      <div className="space-y-4">
        <FormError message={error} />
        {wrongAccount ? (
          <>
            <FormError message={`This invitation is for ${preview.email}. Sign out and sign in with that address to accept it.`} />
            <button
              onClick={async () => {
                await api('/auth/sign-out', { method: 'POST' }).catch(() => {});
                router.push(`/sign-in?next=${encodeURIComponent(next)}&email=${encodeURIComponent(preview.email!)}`);
              }}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              Sign out and switch account
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
