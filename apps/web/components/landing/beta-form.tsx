'use client';

import { TEAM_SIZES, waitlistSchema } from '@workhub/shared';
import { useState } from 'react';
import { issuesToFields } from '@/components/form';
import { api, ApiError } from '@/lib/api';

const inputClass =
  'mt-1 block w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none transition hover:border-gray-300 focus:border-ink focus:ring-4 focus:ring-lime/40';

function Label({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <span className="text-sm font-medium text-gray-700">
      {children}
      {optional && <span className="font-normal text-gray-400"> (optional)</span>}
    </span>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="mt-1 block text-xs text-red-600">
      {message}
    </span>
  );
}

export function BetaForm() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = Object.fromEntries(
      [...new FormData(e.currentTarget)].filter(([, v]) => String(v).trim() !== ''),
    );
    const source = new URLSearchParams(window.location.search).get('utm_source') ?? undefined;
    const parsed = waitlistSchema.safeParse({ ...raw, source });
    if (!parsed.success) {
      setFields(issuesToFields(parsed.error.issues));
      return;
    }
    setFields({});
    setError(undefined);
    setPending(true);
    try {
      await api('/waitlist', { method: 'POST', body: parsed.data });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="animate-pop rounded-3xl bg-lime p-10 text-center text-ink">
        <p className="text-2xl font-light tracking-tight">You&apos;re on the list.</p>
        <p className="mt-2 text-sm text-ink/75">
          We&apos;ve sent you a confirmation email. We&apos;ll invite you as soon as your workspace is ready.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5 rounded-[2rem] bg-white p-6 shadow-sm sm:grid-cols-2 sm:p-8">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
          {error}
        </p>
      )}
      <label className="block">
        <Label>Your name</Label>
        <input name="name" autoComplete="name" aria-describedby="name-error" className={inputClass} />
        <FieldError id="name-error" message={fields.name} />
      </label>
      <label className="block">
        <Label>Work email</Label>
        <input name="email" type="email" autoComplete="email" aria-describedby="email-error" className={inputClass} />
        <FieldError id="email-error" message={fields.email} />
      </label>
      <label className="block">
        <Label>Company</Label>
        <input name="company" autoComplete="organization" aria-describedby="company-error" className={inputClass} />
        <FieldError id="company-error" message={fields.company} />
      </label>
      <label className="block">
        <Label>Team size</Label>
        <select name="teamSize" defaultValue="" aria-describedby="teamSize-error" className={`${inputClass} bg-white`}>
          <option value="" disabled>
            Choose…
          </option>
          {TEAM_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} people
            </option>
          ))}
        </select>
        <FieldError id="teamSize-error" message={fields.teamSize} />
      </label>
      <label className="block sm:col-span-2">
        <Label optional>Which tools does your team use today?</Label>
        <input name="currentTools" placeholder="e.g. Trello, Slack, WhatsApp groups, Excel" className={inputClass} />
      </label>
      <label className="block sm:col-span-2">
        <Label optional>What is the biggest problem you want solved?</Label>
        <textarea name="biggestProblem" rows={3} className={inputClass} />
      </label>
      <label className="block sm:col-span-2">
        <Label optional>Roughly how much do you spend on these tools each month?</Label>
        <input name="monthlySpend" placeholder="e.g. PKR 40,000 or US$150" className={inputClass} />
      </label>
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-ink px-4 py-3.5 text-sm font-medium text-white transition hover:bg-black active:scale-[0.99] disabled:opacity-60"
        >
          {pending ? 'Please wait…' : 'Join the free beta'}
        </button>
        <p className="mt-2 text-center text-xs text-gray-500">No card needed. We only use your answers to build a better product.</p>
      </div>
    </form>
  );
}
