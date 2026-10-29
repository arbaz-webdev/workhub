'use client';

import type { TwoFactorSetupDto, TwoFactorStatusDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { LanguageCard } from '@/components/settings/language-card';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace';

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback);

/** The signed-in person's own account: two-factor sign-in and recovery codes. */
export default function AccountPage() {
  const { me, refresh } = useWorkspace();
  const t = useT();
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
      .catch(() => setResult({ kind: 'error', text: t('account.loadError') }));
  }, [t]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setResult(undefined);
    try {
      await fn();
    } catch (err) {
      setResult({ kind: 'error', text: message(err, t('common.failed')) });
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
        setResult({ kind: 'success', text: t('account.twoFactorOff') });
        await refresh();
      } else {
        setCodes((await api<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { method: 'POST', body: { code } })).recoveryCodes);
      }
      setMode('none');
      setCode('');
      load();
    });

  function download() {
    const text = `${t('account.codesFileTitle', { email: me.user.email })}\n${t('account.codesFileNote')}\n\n${codes!.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workhub-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  const [keyBefore, keyAfter] = t('account.step2').split('{key}');

  return (
    <>
      <PageHeader title={t('nav.account')} description={`${me.user.name} · ${me.user.email}`} />
      <div className="space-y-6" aria-live="polite">
        <LanguageCard />
        {result && <Alert kind={result.kind}>{result.text}</Alert>}

        {codes && (
          <Card title={t('account.codesTitle')} description={t('account.codesHint')}>
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-4 font-mono text-sm sm:grid-cols-5">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={btn.secondary} onClick={download}>
                {t('account.download')}
              </button>
              <button type="button" className={btn.secondary} onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
                {t('account.copy')}
              </button>
              <button type="button" className={btn.primary} onClick={() => setCodes(null)}>
                {t('account.savedThem')}
              </button>
            </div>
          </Card>
        )}

        <Card title={t('twoFactor.title')} description={t('account.twoFactorHint')}>
          {!status ? (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          ) : status.enabled ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">{t('account.on')}</span>
                {status.recoveryCodesLeft === 1 ? t('account.codesLeft.one') : t('account.codesLeft.many', { n: status.recoveryCodesLeft })}
              </p>
              {mode === 'none' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn.secondary} onClick={() => setMode('regenerate')}>
                    {t('account.newCodes')}
                  </button>
                  <button type="button" className={btn.danger} onClick={() => setMode('disable')}>
                    {t('account.turnOff')}
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
                    <span className="text-gray-700">{t('account.codeOrRecovery')}</span>
                    <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="one-time-code" maxLength={11} className={`mt-1 ${input} !w-48 font-mono`} />
                  </label>
                  <button type="submit" className={mode === 'disable' ? btn.danger : btn.primary} disabled={busy}>
                    {mode === 'disable' ? t('account.turnOff') : t('account.makeCodes')}
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => setMode('none')}>
                    {t('common.cancel')}
                  </button>
                </form>
              )}
            </div>
          ) : setup ? (
            <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
              <img src={setup.qr} alt={t('account.qrAlt')} width={220} height={220} className="rounded-lg border border-gray-200" />
              <div className="space-y-3 text-sm">
                <ol className="list-decimal space-y-1 ps-5 text-gray-700">
                  <li>{t('account.step1')}</li>
                  <li>
                    {keyBefore}
                    <code dir="ltr" className="break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono">
                      {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
                    </code>
                    {keyAfter}
                  </li>
                  <li>{t('account.step3')}</li>
                </ol>
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void enable();
                  }}
                >
                  <label className="block">
                    <span className="text-gray-700">{t('twoFactor.code')}</span>
                    <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" className={`mt-1 ${input} !w-36 text-center font-mono tracking-widest`} />
                  </label>
                  <button type="submit" className={btn.primary} disabled={busy || code.replace(/\s/g, '').length < 6}>
                    {busy ? t('account.checking') : t('account.turnOn')}
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => setSetup(null)}>
                    {t('common.cancel')}
                  </button>
                </form>
                <p className="text-xs text-gray-500">{t('account.signsOut')}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{t('account.off')}</span>
                {t('account.recommended')}
              </p>
              <button type="button" className={btn.primary} onClick={() => void start()} disabled={busy}>
                {t('account.setUp')}
              </button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
