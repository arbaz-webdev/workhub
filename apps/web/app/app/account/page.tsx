'use client';

import type { TwoFactorSetupDto, TwoFactorStatusDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, PageHeader, btn, input, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback);

/** The signed-in person's own account: two-factor sign-in and recovery codes. */
export default function AccountPage() {
  const { me, refresh } = useWorkspace();
  const [status, setStatus] = useState<TwoFactorStatusDto>();
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'none' | 'disable' | 'regenerate'>('none');
  const [result, setResult] = useState<{ kind: 'error' | 'success'; text: string }>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<TwoFactorStatusDto>('/auth/2fa')
      .then(setStatus)
      .catch(() => setResult({ kind: 'error', text: 'Could not load your security settings.' }));
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setResult(undefined);
    try {
      await fn();
    } catch (err) {
      setResult({ kind: 'error', text: message(err, 'That didn’t work. Please try again.') });
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => setSetup(await api<TwoFactorSetupDto>('/auth/2fa/setup', { method: 'POST' })));
  const enable = () =>
    run(async () => {
      const res = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', { method: 'POST', body: { code } });
      setCodes(res.recoveryCodes);
      setSetup(null);
      setCode('');
      load();
      await refresh();
    });
  const confirmCode = () =>
    run(async () => {
      if (mode === 'disable') {
        await api('/auth/2fa/disable', { method: 'POST', body: { code } });
        setResult({ kind: 'success', text: 'Two-factor sign-in is off.' });
        await refresh();
      } else {
        setCodes((await api<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { method: 'POST', body: { code } })).recoveryCodes);
      }
      setMode('none');
      setCode('');
      load();
    });

  function download() {
    const text = `WorkHub recovery codes for ${me.user.email}\nEach code works once. Keep them somewhere safe.\n\n${codes!.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workhub-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title="Account" description={`${me.user.name} · ${me.user.email}`} />
      <div className="space-y-6" aria-live="polite">
        {result && <Alert kind={result.kind}>{result.text}</Alert>}

        {codes && (
          <Card title="Your recovery codes" description="If you lose your phone, each of these signs you in once. This is the only time they’re shown.">
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-4 font-mono text-sm sm:grid-cols-5">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={btn.secondary} onClick={download}>
                Download
              </button>
              <button type="button" className={btn.secondary} onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
                Copy
              </button>
              <button type="button" className={btn.primary} onClick={() => setCodes(null)}>
                I’ve saved them
              </button>
            </div>
          </Card>
        )}

        <Card title="Two-factor sign-in" description="After your password (or Google), WorkHub asks for a code from an authenticator app such as Google Authenticator or Microsoft Authenticator.">
          {!status ? (
            <Loading />
          ) : status.enabled ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">On</span>
                {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? '' : 's'} left
              </p>
              {mode === 'none' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn.secondary} onClick={() => setMode('regenerate')}>
                    New recovery codes
                  </button>
                  <button type="button" className={btn.danger} onClick={() => setMode('disable')}>
                    Turn off
                  </button>
                </div>
              ) : (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirmCode();
                  }}
                >
                  <label className="block text-sm">
                    <span className="text-gray-700">A code from your app, or a recovery code</span>
                    <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="one-time-code" maxLength={11} className={`mt-1 ${input} !w-48 font-mono`} />
                  </label>
                  <button type="submit" className={mode === 'disable' ? btn.danger : btn.primary} disabled={busy}>
                    {mode === 'disable' ? 'Turn off' : 'Make new codes'}
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => setMode('none')}>
                    Cancel
                  </button>
                </form>
              )}
            </div>
          ) : setup ? (
            <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
              <img src={setup.qr} alt="QR code to scan with your authenticator app" width={220} height={220} className="rounded-lg border border-gray-200" />
              <div className="space-y-3 text-sm">
                <ol className="list-decimal space-y-1 pl-5 text-gray-700">
                  <li>Open your authenticator app and add an account.</li>
                  <li>Scan the QR code, or type this key: <code className="break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></li>
                  <li>Enter the 6-digit code it shows.</li>
                </ol>
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void enable();
                  }}
                >
                  <label className="block">
                    <span className="text-gray-700">Code</span>
                    <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" className={`mt-1 ${input} !w-36 text-center font-mono tracking-widest`} />
                  </label>
                  <button type="submit" className={btn.primary} disabled={busy || code.replace(/\s/g, '').length < 6}>
                    {busy ? 'Checking…' : 'Turn on'}
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => setSetup(null)}>
                    Cancel
                  </button>
                </form>
                <p className="text-xs text-gray-500">Turning it on signs you out on your other devices.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Off</span>
                Recommended for owners and admins.
              </p>
              <button type="button" className={btn.primary} onClick={() => void start()} disabled={busy}>
                Set up two-factor sign-in
              </button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
