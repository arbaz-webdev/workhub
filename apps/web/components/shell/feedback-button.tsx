'use client';

import { FEEDBACK_KINDS, feedbackSchema, type FeedbackKind } from '@workhub/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useWorkspaceApi } from '@/lib/workspace';

/** "Feedback" in the header: an idea, a problem or praise, straight to the WorkHub team. */
export function FeedbackButton() {
  const api = useWorkspaceApi();
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function show() {
    setSent(false);
    setError(undefined);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = feedbackSchema.safeParse({ kind, message, page: pathname });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSending(true);
    try {
      await api('/feedback', { method: 'POST', body: parsed.data });
      setSent(true);
      setMessage('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('feedback.failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button onClick={show} aria-label={t('feedback.open')} className="grid h-9 place-items-center rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-100 sm:px-3">
        <span className="hidden sm:inline">{t('feedback.button')}</span>
        <svg aria-hidden="true" className="sm:hidden" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-gray-900/40 p-4" onMouseDown={() => setOpen(false)}>
          <form
            onSubmit={submit}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('feedback.open')}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl"
          >
            <div>
              <h2 className="text-base font-semibold">{t('feedback.title')}</h2>
              <p className="text-sm text-gray-500">{t('feedback.subtitle')}</p>
            </div>
            {sent ? (
              <>
                <Alert kind="success">{t('feedback.thanks')}</Alert>
                <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
                  {t('common.close')}
                </button>
              </>
            ) : (
              <>
                {error && <Alert>{error}</Alert>}
                <fieldset className="flex gap-2">
                  <legend className="sr-only">{t('feedback.kind')}</legend>
                  {FEEDBACK_KINDS.map((k) => (
                    <label
                      key={k}
                      className={`cursor-pointer rounded-full border px-3 py-1 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
                        kind === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                      {t(`feedback.kind.${k}`)}
                    </label>
                  ))}
                </fieldset>
                <label className="block text-sm">
                  <span className="text-gray-700">{kind === 'problem' ? t('feedback.askProblem') : kind === 'praise' ? t('feedback.askPraise') : t('feedback.askIdea')}</span>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={4000} required autoFocus className={`mt-1 ${input}`} />
                </label>
                <p className="text-xs text-gray-500">{t('feedback.privacy')}</p>
                <div className="flex gap-2">
                  <button type="submit" className={btn.primary} disabled={sending}>
                    {sending ? t('feedback.sending') : t('feedback.send')}
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => setOpen(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
