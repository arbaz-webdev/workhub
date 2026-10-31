'use client';

import { useState } from 'react';
import { Alert, Card, btn } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/** WorkHub staff: check the email setup by sending a test email to yourself. */
export function TestEmail() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ kind: 'error' | 'success'; text: string }>();

  async function send() {
    setPending(true);
    setResult(undefined);
    try {
      const r = await api<{ to: string; transport: 'console' | 'resend'; from: string }>('/platform/test-email', { method: 'POST' });
      setResult(
        r.transport === 'console'
          ? { kind: 'success', text: `Emails aren't being sent yet (EMAIL_TRANSPORT=console). The test email to ${r.to} is in the API log.` }
          : { kind: 'success', text: `Sent to ${r.to} from ${r.from}. Check the inbox, and the spam folder.` },
      );
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not send the test email.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8">
      <Card title="Email" description="Send a test email to your own address to check the domain and Resend key work.">
        <div className="space-y-3" aria-live="polite">
          {result && <Alert kind={result.kind}>{result.text}</Alert>}
          <button type="button" disabled={pending} className={btn.secondary} onClick={() => void send()}>
            {pending ? 'Sending…' : 'Send me a test email'}
          </button>
        </div>
      </Card>
    </div>
  );
}
