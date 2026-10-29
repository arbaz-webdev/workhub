'use client';

import { MAX_UPLOAD_MB, type TaskDetailDto, type TimerDto } from '@workhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { announceTimer, TIMER_EVENT } from '@/components/shell/timer-chip';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';
import { btn, input, timeAgo } from '@/components/ui';
import { hoursText, localToday } from './style';

type Call = (path: string, method: 'POST' | 'DELETE', body?: unknown) => Promise<TaskDetailDto | undefined>;

function sizeText(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Files on a task: upload (button or drop), image previews, download and remove. */
export function Attachments({
  task,
  canEdit,
  canRemoveAny,
  meId,
  call,
  onError,
}: {
  task: TaskDetailDto;
  canEdit: boolean;
  canRemoveAny: boolean;
  meId: string;
  call: Call;
  onError: (message: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string>();
  const [dragging, setDragging] = useState(false);

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        onError(`${file.name} is larger than ${MAX_UPLOAD_MB} MB.`);
        continue;
      }
      setUploading(file.name);
      const form = new FormData();
      form.append('file', file);
      await call(`/tasks/${task.id}/attachments`, 'POST', form);
    }
    setUploading(undefined);
    if (picker.current) picker.current.value = '';
  }

  return (
    <section
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
      className={dragging ? 'rounded-lg ring-2 ring-brand-400 ring-offset-4' : ''}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-sm font-semibold">
          Files {task.attachments.length > 0 && <span className="font-normal text-gray-500">{task.attachments.length}</span>}
        </h3>
        {canEdit && (
          <>
            <button type="button" className={`${btn.ghost} ms-auto !py-1`} disabled={!!uploading} onClick={() => picker.current?.click()}>
              {uploading ? `Uploading ${uploading}…` : 'Attach file'}
            </button>
            <input ref={picker} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          </>
        )}
      </div>
      {task.attachments.length === 0 ? (
        canEdit && <p className="text-xs text-gray-500">Drop files here or use Attach file. Up to {MAX_UPLOAD_MB} MB each.</p>
      ) : (
        <ul className="space-y-1.5">
          {task.attachments.map((a) => (
            <li key={a.id} className="group flex items-center gap-3 rounded-lg border border-gray-100 p-2">
              {a.isImage ? (
                <a href={`/api${a.url}`} target="_blank" rel="noopener" className="shrink-0">
                  <img src={`/api${a.url}`} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
                </a>
              ) : (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-gray-100 text-[10px] font-semibold uppercase text-gray-500">
                  {a.fileName.includes('.') ? a.fileName.split('.').pop()!.slice(0, 4) : 'file'}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <a href={`/api${a.url}`} target={a.isImage ? '_blank' : undefined} rel="noopener" className="block truncate text-sm text-gray-900 hover:underline" download={a.isImage ? undefined : a.fileName}>
                  {a.fileName}
                </a>
                <p className="text-xs text-gray-500">
                  {sizeText(a.sizeBytes)} · {a.uploadedByName ?? 'Someone'} · {timeAgo(a.createdAt)}
                </p>
              </div>
              {(canRemoveAny || (canEdit && a.uploadedById === meId)) && (
                <button
                  type="button"
                  aria-label={`Remove ${a.fileName}`}
                  className="text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => window.confirm(`Remove ${a.fileName}?`) && call(`/tasks/${task.id}/attachments/${a.id}`, 'DELETE')}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Log time against a task and list what's been logged (this task and its subtasks roll up on the card). */
export function TimeLog({
  task,
  canEdit,
  canRemoveAny,
  meId,
  call,
}: {
  task: TaskDetailDto;
  canEdit: boolean;
  canRemoveAny: boolean;
  meId: string;
  call: Call;
}) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [date, setDate] = useState(localToday);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const total = task.timeEntries.reduce((sum, e) => sum + e.minutes, 0);
  const entered = (Number(hours) || 0) * 60 + (Number(minutes) || 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (entered < 1) return;
    setSaving(true);
    const res = await call(`/tasks/${task.id}/time`, 'POST', { minutes: Math.round(entered), workDate: date, note: note.trim() || undefined });
    setSaving(false);
    if (res) {
      setHours('');
      setMinutes('');
      setNote('');
      setOpen(false);
    }
  }

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-sm font-semibold">
          Time {total > 0 && <span className="font-normal text-gray-500">{hoursText(total / 60)} logged</span>}
          {task.estimateHours !== null && <span className="font-normal text-gray-500"> of {hoursText(task.estimateHours)}</span>}
        </h3>
        {canEdit && !open && (
          <span className="ms-auto flex items-center gap-1">
            <TimerButton taskId={task.id} />
            <button type="button" className={`${btn.ghost} !py-1`} onClick={() => setOpen(true)}>
              Log time
            </button>
          </span>
        )}
      </div>
      {open && (
        <form onSubmit={submit} className="mb-2 space-y-2 rounded-lg border border-gray-200 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-600">
              Hours
              <input type="number" min={0} max={24} step={1} value={hours} onChange={(e) => setHours(e.target.value)} className={`${input} mt-1 w-20`} autoFocus />
            </label>
            <label className="text-xs text-gray-600">
              Minutes
              <input type="number" min={0} max={59} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${input} mt-1 w-20`} />
            </label>
            <label className="text-xs text-gray-600">
              Date
              <input type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} className={`${input} mt-1`} required />
            </label>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on? (optional)" maxLength={500} className={input} aria-label="Note" />
          <div className="flex gap-2">
            <button type="submit" className={`${btn.primary} !py-1.5`} disabled={saving || entered < 1 || entered > 24 * 60}>
              {saving ? 'Saving…' : 'Log time'}
            </button>
            <button type="button" className={btn.ghost} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {task.timeEntries.length > 0 && (
        <ul className="space-y-1 text-sm">
          {task.timeEntries.map((e) => (
            <li key={e.id} className="group flex items-baseline gap-2">
              <span className="w-14 shrink-0 font-medium tabular-nums">{hoursText(e.minutes / 60)}</span>
              <span className="min-w-0 flex-1 truncate text-gray-600">
                {e.user?.name ?? 'Someone'} · {new Date(`${e.workDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                {e.note && <span className="text-gray-500"> — {e.note}</span>}
              </span>
              {(canRemoveAny || e.user?.id === meId) && canEdit && (
                <button
                  type="button"
                  aria-label="Remove time entry"
                  className="text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => call(`/tasks/${task.id}/time/${e.id}`, 'DELETE')}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Start or stop timing this task. Starting stops (and logs) a timer on another task. */
function TimerButton({ taskId }: { taskId: string }) {
  const api = useWorkspaceApi();
  const [running, setRunning] = useState<TimerDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<TimerDto | Record<string, never>>('/timer')
      .then((t) => setRunning('taskId' in t ? (t as TimerDto) : null))
      .catch(() => setRunning(null));
  }, [api]);

  useEffect(() => {
    load();
    window.addEventListener(TIMER_EVENT, load);
    return () => window.removeEventListener(TIMER_EVENT, load);
  }, [load]);

  const here = running?.taskId === taskId;
  async function toggle() {
    setBusy(true);
    setError(undefined);
    try {
      if (here) await api('/timer/stop', { method: 'POST' });
      else await api(`/tasks/${taskId}/timer/start`, { method: 'POST' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the timer.');
    } finally {
      setBusy(false);
      announceTimer();
    }
  }

  return (
    <>
      <button type="button" onClick={toggle} disabled={busy} className={`${btn.ghost} !py-1 ${here ? 'text-red-600' : ''}`} title={running && !here ? `Stops the timer on ${running.taskTitle}` : undefined}>
        {here ? '■ Stop timer' : '▶ Start timer'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </>
  );
}
