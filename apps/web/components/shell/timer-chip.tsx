'use client';

import type { TimerDto } from '@workhub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';

/** Fired whenever a timer starts or stops anywhere in the app, so every view refreshes. */
export const TIMER_EVENT = 'workhub:timer';
export const announceTimer = () => window.dispatchEvent(new Event(TIMER_EVENT));

function elapsed(startedAt: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The running timer in the top bar, with a stop button. Hidden when nothing is running. */
export function TimerChip() {
  const api = useWorkspaceApi();
  const [timer, setTimer] = useState<TimerDto | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** A short "what happened" after stopping, since the chip itself disappears. */
  const [flash, setFlash] = useState<string>();

  const load = useCallback(() => {
    // An empty object means no timer.
    api<TimerDto | Record<string, never>>('/timer')
      .then((t) => setTimer('taskId' in t ? (t as TimerDto) : null))
      .catch(() => setTimer(null));
  }, [api]);

  useEffect(() => {
    load();
    window.addEventListener(TIMER_EVENT, load);
    return () => window.removeEventListener(TIMER_EVENT, load);
  }, [load]);

  useEffect(() => {
    if (!timer) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [timer]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(undefined), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  if (!timer) {
    return flash ? (
      <span role="status" className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
        {flash}
      </span>
    ) : null;
  }

  async function stop() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ loggedMinutes: number } | Record<string, never>>('/timer/stop', { method: 'POST' });
      const minutes = 'loggedMinutes' in r ? r.loggedMinutes : 0;
      setFlash(minutes > 0 ? `Logged ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} on ${timer!.taskTitle}` : 'Under a minute: nothing logged');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not stop the timer.');
    } finally {
      setBusy(false);
      announceTimer();
    }
  }

  return (
    <span className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm text-brand-800">
      <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
      <Link href={`/app/projects/${timer.projectId}?task=${timer.taskId}`} className="max-w-40 truncate hover:underline" title={`${timer.projectName}: ${timer.taskTitle}`}>
        {timer.taskTitle}
      </Link>
      <span className="tabular-nums" role="timer" aria-label="Time on this task">
        {elapsed(timer.startedAt, now)}
      </span>
      <button type="button" onClick={stop} disabled={busy} className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">
        Stop
      </button>
      {error && (
        <span role="alert" className="ml-1 max-w-56 truncate text-xs text-red-700" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}
