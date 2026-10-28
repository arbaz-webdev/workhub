'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Card, btn } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

/** The owner's switch: everyone in the workspace must use two-factor sign-in. */
export function TwoFactorRule() {
  const { workspace, me, refresh } = useWorkspace();
  const api = useWorkspaceApi();
  const required = !!workspace.requireTwoFactor;
  const [result, setResult] = useState<{ kind: 'error' | 'success'; text: string }>();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!required && !confirm('Everyone without two-factor sign-in will be asked to set it up before they can continue. Require it?')) return;
    setBusy(true);
    setResult(undefined);
    try {
      const res = await api<{ required: boolean; withoutTwoFactor: number }>('/workspaces/current/require-two-factor', { method: 'POST', body: { required: !required } });
      setResult({
        kind: 'success',
        text: res.required ? (res.withoutTwoFactor ? `Required. ${res.withoutTwoFactor} ${res.withoutTwoFactor === 1 ? 'person' : 'people'} will be asked to set it up.` : 'Required. Everyone already uses it.') : 'No longer required.',
      });
      await refresh();
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not change it.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <Card title="Security" description="Require two-factor sign-in (a code from an authenticator app) of everyone in this workspace.">
        <div className="space-y-3" aria-live="polite">
          {result && <Alert kind={result.kind}>{result.text}</Alert>}
          <p className="text-sm text-gray-700">
            {required ? 'Required for everyone.' : 'Not required.'}{' '}
            {!me.user.twoFactorEnabled && (
              <>
                Turn it on for yourself first in{' '}
                <Link href="/app/account" className="text-brand-700 underline">
                  Account
                </Link>
                .
              </>
            )}
          </p>
          <button type="button" className={required ? btn.secondary : btn.primary} disabled={busy || (!required && !me.user.twoFactorEnabled)} onClick={() => void toggle()}>
            {required ? 'Stop requiring it' : 'Require two-factor sign-in'}
          </button>
        </div>
      </Card>
    </div>
  );
}
