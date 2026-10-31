'use client';

import { FEEDBACK_KINDS, feedbackSchema, type FeedbackKind } from '@workhub/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';

const KIND_LABELS: Record<FeedbackKind, string> = { idea: 'Idea', problem: 'Problem', praise: 'Praise' };

/** "Feedback" in the header: an idea, a problem or praise, straight to the WorkHub team. */
export function FeedbackButton() {
  const api = useWorkspaceApi();
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
      setError(err instanceof ApiError ? err.message : 'Could not send it. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button onClick={show} aria-label="Send feedback" className="grid h-10 place-items-center rounded-full bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition hover:text-ink hover:shadow-md sm:px-4">
        <span className="hidden sm:inline">Feedback</span>
        <svg aria-hidden="true" className="sm:hidden" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid animate-fade place-items-center bg-ink/30 p-4 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <form
            onSubmit={submit}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Send feedback"
            className="w-full max-w-md animate-pop space-y-4 rounded-3xl bg-white p-6 shadow-lg"
          >
            <div>
              <h2 className="text-base font-semibold">Tell us what you think</h2>
              <p className="text-sm text-gray-500">It goes straight to the people building WorkHub.</p>
            </div>
            {sent ? (
              <>
                <Alert kind="success">Thank you. We read every message.</Alert>
                <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
                  Close
                </button>
              </>
            ) : (
              <>
                {error && <Alert>{error}</Alert>}
                <fieldset className="flex gap-2">
                  <legend className="sr-only">Kind of feedback</legend>
                  {FEEDBACK_KINDS.map((k) => (
                    <label
                      key={k}
                      className={`cursor-pointer rounded-full border px-3 py-1 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
                        kind === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                      {KIND_LABELS[k]}
                    </label>
                  ))}
                </fieldset>
                <label className="block text-sm">
                  <span className="text-gray-700">{kind === 'problem' ? 'What went wrong? What did you expect?' : kind === 'praise' ? 'What do you like?' : 'What would make WorkHub better for you?'}</span>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={4000} required autoFocus className={`mt-1 ${input}`} />
                </label>
                <p className="text-xs text-gray-500">We include the page you’re on and your browser, to help us reproduce problems.</p>
                <div className="flex gap-2">
                  <button type="submit" className={btn.primary} disabled={sending}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => setOpen(false)}>
                    Cancel
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
