'use client';

import { MAX_CHAT_FILES, MAX_TASK_CARDS, MAX_UPLOAD_MB, type PersonDto, type TaskRefDto } from '@workhub/shared';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useWorkspaceApi } from '@/lib/workspace';
import { Avatar, fileSize, PresenceDot } from './bits';

export interface Draft {
  body: string;
  mentions: string[];
  taskIds: string[];
  files: File[];
}

type Suggest = { kind: 'person'; query: string; start: number } | { kind: 'task'; query: string; start: number };

/**
 * The message box. "@" suggests people, "#" suggests tasks (shown as cards), and files
 * can be attached, dropped or pasted. Enter sends; Shift+Enter starts a new line.
 */
export function Composer({
  people,
  placeholder,
  onSend,
  initial,
  onCancel,
  allowFiles = true,
  autoFocus = false,
}: {
  people: PersonDto[];
  placeholder: string;
  onSend: (draft: Draft) => Promise<void>;
  /** Editing an existing message. */
  initial?: { body: string; mentions: string[]; taskIds: string[] };
  onCancel?: () => void;
  allowFiles?: boolean;
  autoFocus?: boolean;
}) {
  const api = useWorkspaceApi();
  const t = useT();
  const [body, setBody] = useState(initial?.body ?? '');
  const [picked, setPicked] = useState<PersonDto[]>(() => people.filter((p) => initial?.mentions.includes(p.id)));
  const [tasks, setTasks] = useState<string[]>(initial?.taskIds ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [taskHits, setTaskHits] = useState<TaskRefDto[]>([]);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [body]);

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);

  // Tasks matching "#..." (debounced).
  useEffect(() => {
    if (suggest?.kind !== 'task') return;
    const timer = setTimeout(() => {
      api<TaskRefDto[]>(`/chat/tasks?q=${encodeURIComponent(suggest.query)}`)
        .then(setTaskHits)
        .catch(() => setTaskHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [api, suggest?.kind, suggest?.query]);

  const personHits =
    suggest?.kind === 'person'
      ? people.filter((p) => p.name.toLowerCase().includes(suggest.query.toLowerCase()) || p.email.toLowerCase().startsWith(suggest.query.toLowerCase())).slice(0, 6)
      : [];
  const hits = suggest?.kind === 'person' ? personHits.length : suggest?.kind === 'task' ? taskHits.length : 0;

  function onChange(value: string) {
    setBody(value);
    setError(undefined);
    const caret = box.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const at = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    const hash = /(^|\s)#([^\s#]{0,40})$/.exec(before);
    if (at) setSuggest({ kind: 'person', query: at[2]!, start: caret - at[2]!.length - 1 });
    else if (hash) setSuggest({ kind: 'task', query: hash[2]!, start: caret - hash[2]!.length - 1 });
    else setSuggest(null);
    setActive(0);
  }

  function insert(text: string) {
    if (!suggest) return;
    // The box's own value, in case keys arrived since the last render.
    const value = box.current?.value ?? body;
    const caret = box.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, suggest.start)}${text} ${value.slice(caret)}`;
    setBody(next);
    setSuggest(null);
    const pos = suggest.start + text.length + 1;
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(pos, pos);
    });
  }

  function pickPerson(p: PersonDto) {
    setPicked((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
    insert(`@${p.name}`);
  }

  function pickTask(task: TaskRefDto) {
    if (tasks.length >= MAX_TASK_CARDS && !tasks.includes(task.id)) {
      setError(t('composer.tooManyTasks', { n: MAX_TASK_CARDS }));
      setSuggest(null);
      return;
    }
    setTasks((list) => (list.includes(task.id) ? list : [...list, task.id]));
    insert(`#${task.title}`);
  }

  function addFiles(list: FileList | File[]) {
    const incoming = [...list];
    const tooBig = incoming.find((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig) return setError(t('composer.tooBig', { name: tooBig.name, n: MAX_UPLOAD_MB }));
    const next = [...files, ...incoming];
    if (next.length > MAX_CHAT_FILES) return setError(t('composer.tooManyFiles', { n: MAX_CHAT_FILES }));
    setFiles(next);
    setError(undefined);
  }

  async function submit() {
    const text = body.trim();
    if (!text && files.length === 0) return;
    setSending(true);
    try {
      await onSend({
        body: text,
        // Only people still named in the text are mentioned.
        mentions: picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id),
        taskIds: tasks,
        files,
      });
      setBody('');
      setPicked([]);
      setTasks([]);
      setFiles([]);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('composer.sendFailed'));
    } finally {
      setSending(false);
      box.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggest && hits > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : hits - 1)) % hits);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (suggest.kind === 'person') pickPerson(personHits[active]!);
        else pickTask(taskHits[active]!);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (suggest) setSuggest(null);
      else onCancel?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div
      className="relative"
      onDragOver={(e) => allowFiles && e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!allowFiles || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {suggest && hits > 0 && (
        <ul role="listbox" aria-label={suggest.kind === 'person' ? t('composer.mention') : t('composer.linkTask')} className="absolute bottom-full start-0 z-20 mb-1 w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
          {suggest.kind === 'person'
            ? personHits.map((p, i) => (
                <li key={p.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickPerson(p)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm ${i === active ? 'bg-brand-50' : 'hover:bg-gray-50'}`}
                  >
                    <Avatar person={p} size="sm" />
                    <span className="truncate font-medium">{p.name}</span>
                    <PresenceDot userId={p.id} />
                    <span className="ms-auto truncate text-xs text-gray-400">{p.email}</span>
                  </button>
                </li>
              ))
            : taskHits.map((task, i) => (
                <li key={task.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickTask(task)}
                    className={`block w-full rounded-lg px-2 py-1.5 text-start text-sm ${i === active ? 'bg-brand-50' : 'hover:bg-gray-50'}`}
                  >
                    <span className={`block truncate font-medium ${task.completed ? 'text-gray-500 line-through' : ''}`}>{task.title}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {task.projectName} · {task.columnName}
                    </span>
                  </button>
                </li>
              ))}
        </ul>
      )}

      <div className="rounded-xl border border-gray-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-3 pt-2" aria-label={t('composer.files')}>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex max-w-56 items-center gap-1.5 rounded-lg bg-gray-100 py-1 ps-2 pe-1 text-xs">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-gray-500">{fileSize(f.size)}</span>
                <button type="button" aria-label={t('composer.removeFile', { name: f.name })} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="grid h-5 w-5 place-items-center rounded text-gray-500 hover:bg-gray-200">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={box}
          value={body}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          onPaste={(e) => {
            if (allowFiles && e.clipboardData.files.length > 0) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          rows={1}
          maxLength={8000}
          placeholder={placeholder}
          aria-label={placeholder}
          className="block max-h-[200px] w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          {allowFiles && (
            <>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && (addFiles(e.target.files), (e.target.value = ''))} />
              <button type="button" onClick={() => fileInput.current?.click()} aria-label={t('composer.attach')} title={t('composer.attach')} className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                </svg>
              </button>
            </>
          )}
          <span className="hidden text-xs text-gray-400 sm:inline">{t('composer.hint')}</span>
          <span className="ms-auto flex items-center gap-1">
            {onCancel && (
              <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
                {t('common.cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || (!body.trim() && files.length === 0)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {sending ? (initial ? t('composer.saving') : t('composer.sending')) : initial ? t('common.save') : t('composer.send')}
            </button>
          </span>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
