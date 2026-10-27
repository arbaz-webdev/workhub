'use client';

import { correctionSchema } from '@workhub/shared';
import { useEffect, useState } from 'react';
import { Alert, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { dayLabel, zonedClock, zonedToIso } from '@/lib/time';
import { useWorkspaceApi } from '@/lib/workspace';

/**
 * Ask for a day's check-in and check-out to be corrected, or, as a manager for someone
 * else (`userId`), correct it straight away. Times are in the workspace's time zone.
 */
export function CorrectionDialog({
  date,
  timeZone,
  userId,
  personName,
  current,
  direct = false,
  onClose,
  onDone,
}: {
  date: string;
  timeZone: string;
  userId?: string;
  personName?: string;
  current?: { checkInAt: string | null; checkOutAt: string | null };
  /** Applied straight away (a manager for someone else, or the owner) rather than sent for approval. */
  direct?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const api = useWorkspaceApi();
  const [inTime, setIn] = useState(current?.checkInAt ? zonedClock(current.checkInAt, timeZone) : '09:00');
  const [outTime, setOut] = useState(current?.checkOutAt ? zonedClock(current.checkOutAt, timeZone) : '18:00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // A check-out at or before the check-in is the next morning (night shifts).
  const overnight = outTime <= inTime;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = correctionSchema.safeParse({
      date,
      checkInAt: zonedToIso(date, inTime, timeZone),
      checkOutAt: zonedToIso(date, outTime, timeZone, overnight),
      reason,
      userId,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSaving(true);
    try {
      const res = await api<{ status: string }>('/attendance/corrections', { method: 'POST', body: parsed.data });
      onDone(res.status === 'approved' ? 'Attendance corrected.' : 'Correction sent to your manager.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the correction.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-gray-900/40 p-4" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Correct attendance"
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl"
      >
        <div>
          <h2 className="text-base font-semibold">{personName ? `Correct ${personName}’s day` : direct ? 'Correct your day' : 'Ask for a correction'}</h2>
          <p className="text-sm text-gray-500">{dayLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}. The original record is kept.</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-gray-700">Checked in</span>
            <input type="time" value={inTime} onChange={(e) => setIn(e.target.value)} className={`mt-1 ${input}`} required />
          </label>
          <label className="text-sm">
            <span className="text-gray-700">Checked out {overnight && <span className="text-brand-700">(next day)</span>}</span>
            <input type="time" value={outTime} onChange={(e) => setOut(e.target.value)} className={`mt-1 ${input}`} required />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">Why?</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to check out" className={`mt-1 ${input}`} required maxLength={500} autoFocus />
        </label>
        <div className="flex gap-2">
          <button type="submit" className={btn.primary} disabled={saving}>
            {saving ? 'Saving…' : personName || direct ? 'Correct' : 'Send to manager'}
          </button>
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
