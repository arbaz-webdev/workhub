'use client';

import {
  LABEL_COLORS,
  PRIORITIES,
  type BoardDto,
  type LabelColor,
  type LabelDto,
  type Locale,
  type PersonDto,
  type Priority,
  type TaskDetailDto,
  type UpdateTaskInput,
} from '@workhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, input, timeAgo } from '@/components/ui';
import { duration } from '@/components/attendance/labels';
import { ApiError } from '@/lib/api';
import { translate, useLocale, useT } from '@/lib/i18n';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';
import { initials, LABEL_STYLES } from './style';
import { Attachments, TimeLog } from './task-extras';

interface Props {
  taskId: string;
  board: BoardDto;
  onClose: () => void;
  onLabelsChanged: (labels: LabelDto[]) => void;
  /** Bumped by the page when a live event says this task changed elsewhere. */
  version: number;
}

function describeActivity(type: string, data: Record<string, unknown>, locale: Locale): string {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(locale, key, vars);
  const s = (v: unknown) => String(v);
  const what = (() => {
    switch (type) {
      case 'task.created':
        return t('activity.created');
      case 'subtask.created':
        return t('activity.subtaskAdded', { title: s(data.title) });
      case 'subtask.deleted':
        return t('activity.subtaskDeleted', { title: s(data.title) });
      case 'task.moved':
        return t('activity.moved', { from: s(data.from), to: s(data.to) });
      case 'task.updated': {
        const parts: string[] = [];
        if (data.subtask) parts.push(t('activity.onSubtask', { name: s(data.subtask) }));
        if ('title' in data) parts.push(t('activity.renamed', { title: s(data.title) }));
        if ('priority' in data) parts.push(t('activity.priority', { priority: t(`priority.${data.priority as Priority}`) }));
        if ('startDate' in data) parts.push(data.startDate ? t('activity.startSet', { date: s(data.startDate) }) : t('activity.startRemoved'));
        if ('dueDate' in data) parts.push(data.dueDate ? t('activity.dueSet', { date: s(data.dueDate) }) : t('activity.dueRemoved'));
        if ('estimateHours' in data) parts.push(data.estimateHours !== null ? t('activity.estimated', { hours: s(data.estimateHours) }) : t('activity.estimateRemoved'));
        if ('completed' in data) parts.push(data.completed ? t('activity.completed') : t('activity.reopened'));
        if ('description' in data) parts.push(t('activity.description'));
        if ('assigned' in data) parts.push(t('activity.assignees'));
        return parts.join(t('inbox.listSeparator')) || t('activity.updated');
      }
      case 'time.logged': {
        const m = Number(data.minutes);
        const time = locale === 'en' ? (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`) : duration(m, locale);
        return data.subtask ? t('activity.loggedOn', { time, name: s(data.subtask) }) : t('activity.logged', { time });
      }
      case 'attachment.added':
        return t('activity.attached', { name: s(data.fileName) });
      case 'attachment.removed':
        return t('activity.detached', { name: s(data.fileName) });
      default:
        return type;
    }
  })();
  return t('activity.prefix') + what;
}

export function TaskPanel({ taskId, board, onClose, onLabelsChanged, version }: Props) {
  const api = useWorkspaceApi();
  const t = useT();
  const locale = useLocale();
  const { me } = useWorkspace();
  const [task, setTask] = useState<TaskDetailDto>();
  const [error, setError] = useState<string>();
  const panel = useRef<HTMLDivElement>(null);
  const canEdit = board.canEdit;

  const load = useCallback(() => {
    api<TaskDetailDto>(`/tasks/${taskId}`)
      .then(setTask)
      .catch(() => setError(t('panel.gone')));
  }, [api, taskId, t]);

  useEffect(load, [load, version]);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function call(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<TaskDetailDto | undefined> {
    setError(undefined);
    try {
      const res = await api<TaskDetailDto>(path, { method, body });
      if (res) setTask(res);
      return res;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('att.genericError'));
    }
  }

  const update = (body: UpdateTaskInput) => call(`/tasks/${taskId}`, 'PATCH', body);

  async function remove() {
    if (!task || !window.confirm(t('panel.confirmDelete', { title: task.title }))) return;
    try {
      await api(`/tasks/${taskId}`, { method: 'DELETE' });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('panel.deleteFailed'));
    }
  }

  async function move(columnId: string) {
    setError(undefined);
    try {
      await api(`/tasks/${taskId}/move`, { method: 'POST', body: { columnId, index: 100_000 } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('board.moveFailed'));
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-gray-900/20" onMouseDown={onClose}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={task?.title ?? t('board.timeline.task')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl outline-none"
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-white px-5 py-3">
          {task && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={task.completed}
                disabled={!canEdit}
                onChange={(e) => update({ completed: e.target.checked })}
                className="h-4 w-4 accent-brand-600"
              />
              {task.completed ? t('panel.completed') : t('panel.markComplete')}
            </label>
          )}
          <div className="ms-auto flex gap-1">
            {canEdit && task && (
              <button onClick={remove} className={btn.danger}>
                {t('board.delete')}
              </button>
            )}
            <button onClick={onClose} aria-label={t('panel.close')} className={btn.ghost}>
              ✕
            </button>
          </div>
        </div>

        {!task ? (
          <p className="p-6 text-sm text-gray-500">{error ?? t('common.loading')}</p>
        ) : (
          <div className="space-y-6 p-5">
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <InlineText
              key={`title-${task.title}`}
              value={task.title}
              disabled={!canEdit}
              label={t('panel.title')}
              className="w-full rounded-lg border border-transparent px-2 py-1 text-xl font-semibold hover:border-gray-200 focus:border-brand-500 focus:outline-none"
              onSave={(title) => title.trim() && title !== task.title && update({ title: title.trim() })}
            />

            <dl className="grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
              <dt className="text-gray-500">{t('list.column')}</dt>
              <dd>
                <select
                  value={task.columnId}
                  disabled={!canEdit}
                  onChange={(e) => move(e.target.value)}
                  aria-label={t('list.column')}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1"
                >
                  {board.columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </dd>

              <dt className="text-gray-500">{t('list.assignees')}</dt>
              <dd>
                <Assignees people={board.people} value={task.assigneeIds} disabled={!canEdit} onChange={(ids) => update({ assigneeIds: ids })} />
              </dd>

              <dt className="text-gray-500">{t('list.priority')}</dt>
              <dd>
                <select
                  value={task.priority}
                  disabled={!canEdit}
                  onChange={(e) => update({ priority: e.target.value as Priority })}
                  aria-label={t('list.priority')}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`priority.${p}`)}
                    </option>
                  ))}
                </select>
              </dd>

              <dt className="text-gray-500">{t('panel.startDate')}</dt>
              <dd>
                <input
                  type="date"
                  value={task.startDate ?? ''}
                  max={task.dueDate ?? undefined}
                  disabled={!canEdit}
                  onChange={(e) => update({ startDate: e.target.value || null })}
                  aria-label={t('panel.startDate')}
                  className="rounded-lg border border-gray-300 px-2 py-1"
                />
              </dd>

              <dt className="text-gray-500">{t('list.dueDate')}</dt>
              <dd>
                <input
                  type="date"
                  value={task.dueDate ?? ''}
                  min={task.startDate ?? undefined}
                  disabled={!canEdit}
                  onChange={(e) => update({ dueDate: e.target.value || null })}
                  aria-label={t('list.dueDate')}
                  className="rounded-lg border border-gray-300 px-2 py-1"
                />
              </dd>

              <dt className="text-gray-500">{t('panel.estimate')}</dt>
              <dd className="flex items-center gap-1.5">
                <InlineText
                  key={`est-${task.estimateHours}`}
                  value={task.estimateHours === null ? '' : String(task.estimateHours)}
                  disabled={!canEdit}
                  label={t('panel.estimateHours')}
                  inputMode="decimal"
                  className="w-20 rounded-lg border border-gray-300 px-2 py-1"
                  onSave={(v) => {
                    const n = v.trim() === '' ? null : Number(v);
                    if (n === null || (Number.isFinite(n) && n >= 0)) return update({ estimateHours: n });
                  }}
                />
                <span className="text-gray-500">{t('panel.hours')}</span>
              </dd>

              <dt className="text-gray-500">{t('panel.labels')}</dt>
              <dd>
                <Labels
                  board={board}
                  value={task.labelIds}
                  disabled={!canEdit}
                  onChange={(ids) => update({ labelIds: ids })}
                  onLabelsChanged={onLabelsChanged}
                />
              </dd>
            </dl>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">{t('panel.description')}</h3>
              <InlineText
                key={`desc-${task.description}`}
                value={task.description ?? ''}
                multiline
                disabled={!canEdit}
                label={t('panel.description')}
                placeholder={canEdit ? t('panel.descriptionPlaceholder') : t('panel.noDescription')}
                className={`${input} min-h-[6rem]`}
                onSave={(v) => v !== (task.description ?? '') && update({ description: v || null })}
              />
            </section>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">
                {t('panel.checklist')} {task.checklist.length > 0 && <span className="font-normal text-gray-500">{task.checklistDone}/{task.checklistTotal}</span>}
              </h3>
              <ul className="space-y-1">
                {task.checklist.map((item) => (
                  <li key={item.id} className="group flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={!canEdit}
                      onChange={(e) => call(`/tasks/${taskId}/checklist/${item.id}`, 'PATCH', { done: e.target.checked })}
                      aria-label={item.text}
                      className="h-4 w-4 accent-brand-600"
                    />
                    <span className={item.done ? 'text-gray-400 line-through' : ''}>{item.text}</span>
                    {canEdit && (
                      <button
                        onClick={() => call(`/tasks/${taskId}/checklist/${item.id}`, 'DELETE')}
                        aria-label={t('composer.removeFile', { name: item.text })}
                        className="ms-auto text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && <AddLine placeholder={t('panel.addItem')} onAdd={(text) => call(`/tasks/${taskId}/checklist`, 'POST', { text })} />}
            </section>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">
                {t('panel.subtasks')} {task.subtasks.length > 0 && <span className="font-normal text-gray-500">{task.subtasksDone}/{task.subtasksTotal}</span>}
              </h3>
              <ul className="space-y-1">
                {task.subtasks.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={s.completed}
                      disabled={!canEdit}
                      onChange={async (e) => {
                        await api(`/tasks/${s.id}`, { method: 'PATCH', body: { completed: e.target.checked } }).catch(() => {});
                        load();
                      }}
                      aria-label={s.title}
                      className="h-4 w-4 accent-brand-600"
                    />
                    <span className={s.completed ? 'text-gray-400 line-through' : ''}>{s.title}</span>
                  </li>
                ))}
              </ul>
              {canEdit && (
                <AddLine
                  placeholder={t('panel.addSubtask')}
                  onAdd={async (title) => {
                    await api(`/projects/${board.project.id}/tasks`, { method: 'POST', body: { title, parentTaskId: taskId } }).catch(() => {});
                    load();
                  }}
                />
              )}
            </section>

            <TimeLog task={task} canEdit={canEdit} canRemoveAny={board.canManage} meId={me.user.id} call={call} />

            <Attachments task={task} canEdit={canEdit} canRemoveAny={board.canManage} meId={me.user.id} call={call} onError={setError} />

            <Comments task={task} people={board.people} meId={me.user.id} onPost={(body, mentions) => call(`/tasks/${taskId}/comments`, 'POST', { body, mentions })} onDelete={(id) => call(`/tasks/${taskId}/comments/${id}`, 'DELETE')} />

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">{t('panel.activity')}</h3>
              <ul className="space-y-1.5 text-xs text-gray-500">
                {task.activity.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium text-gray-700">{a.actorName ?? t('common.someone')}</span> {describeActivity(a.type, a.data, locale)} ·{' '}
                    {timeAgo(a.createdAt, locale)}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Text that saves when it loses focus (or on Enter for single lines). */
function InlineText({
  value,
  onSave,
  multiline,
  disabled,
  label,
  placeholder,
  className,
  inputMode,
}: {
  value: string;
  onSave: (v: string) => unknown;
  multiline?: boolean;
  disabled?: boolean;
  label: string;
  placeholder?: string;
  className?: string;
  inputMode?: 'decimal';
}) {
  const [draft, setDraft] = useState(value);
  const common = {
    value: draft,
    disabled,
    'aria-label': label,
    placeholder,
    className,
    onBlur: () => draft !== value && onSave(draft),
  };
  return multiline ? (
    <textarea {...common} onChange={(e) => setDraft(e.target.value)} rows={4} />
  ) : (
    <input
      {...common}
      inputMode={inputMode}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function AddLine({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => unknown }) {
  return (
    <form
      className="mt-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const text = String(new FormData(form).get('text') ?? '').trim();
        if (!text) return;
        await onAdd(text);
        form.reset();
      }}
    >
      <input name="text" placeholder={placeholder} aria-label={placeholder} className={`${input} py-1.5`} />
    </form>
  );
}

function Assignees({ people, value, disabled, onChange }: { people: PersonDto[]; value: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = people.filter((p) => value.includes(p.id));
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[2rem] flex-wrap items-center gap-1 rounded-lg px-1 py-0.5 text-start hover:bg-gray-50 disabled:hover:bg-transparent"
      >
        {selected.length === 0 && <span className="text-gray-400">{disabled ? t('panel.nobody') : t('panel.assignSomeone')}</span>}
        {selected.map((p) => (
          <span key={p.id} className="flex items-center gap-1 rounded-full bg-gray-100 py-0.5 ps-0.5 pe-2 text-xs">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">{initials(p.name)}</span>
            {p.name}
          </span>
        ))}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
          {people.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
              <input
                type="checkbox"
                checked={value.includes(p.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((v) => v !== p.id))}
                className="accent-brand-600"
              />
              {p.name}
            </label>
          ))}
          <button onClick={() => setOpen(false)} className="mt-1 w-full rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function Labels({
  board,
  value,
  disabled,
  onChange,
  onLabelsChanged,
}: {
  board: BoardDto;
  value: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  onLabelsChanged: (labels: LabelDto[]) => void;
}) {
  const api = useWorkspaceApi();
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [color, setColor] = useState<LabelColor>('blue');

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    const labels = await api<LabelDto[]>(`/projects/${board.project.id}/labels`, { method: 'POST', body: { name, color } }).catch(() => null);
    if (!labels) return;
    onLabelsChanged(labels);
    const added = labels.find((l) => l.name === name && !board.labels.some((b) => b.id === l.id));
    if (added) onChange([...value, added.id]);
    setCreating(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {board.labels.map((l) => {
        const on = value.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== l.id) : [...value, l.id])}
            className={`rounded px-2 py-0.5 text-xs font-medium ${LABEL_STYLES[l.color]} ${on ? 'ring-2 ring-offset-1 ring-gray-400' : 'opacity-50 hover:opacity-100'}`}
          >
            {l.name}
          </button>
        );
      })}
      {!disabled &&
        (creating ? (
          <form onSubmit={create} className="flex items-center gap-1.5">
            <input name="name" autoFocus placeholder={t('list.label')} aria-label={t('panel.newLabelName')} className="w-24 rounded-lg border border-gray-300 px-2 py-0.5 text-xs" />
            <select value={color} onChange={(e) => setColor(e.target.value as LabelColor)} aria-label={t('panel.labelColour')} className="rounded-lg border border-gray-300 px-1 py-0.5 text-xs">
              {LABEL_COLORS.map((c) => (
                <option key={c} value={c}>
                  {t(`color.${c}`)}
                </option>
              ))}
            </select>
            <button type="submit" className="text-xs font-medium text-brand-700">
              {t('common.add')}
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="text-xs text-gray-500 hover:text-gray-800">
            {t('panel.newLabel')}
          </button>
        ))}
    </div>
  );
}

/** Comments with @mentions: typing "@" suggests people; picking one inserts "@Name" and records them. */
function Comments({
  task,
  people,
  meId,
  onPost,
  onDelete,
}: {
  task: TaskDetailDto;
  people: PersonDto[];
  meId: string;
  onPost: (body: string, mentions: string[]) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<PersonDto[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const suggestions = query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  function onChange(value: string) {
    setText(value);
    const caret = area.current?.selectionStart ?? value.length;
    const match = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(value.slice(0, caret));
    setQuery(match ? match[1]! : null);
  }

  function pick(p: PersonDto) {
    const caret = area.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([\p{L}\p{N}._-]*)$/u, `@${p.name} `);
    setText(before + text.slice(caret));
    setPicked((cur) => (cur.some((c) => c.id === p.id) ? cur : [...cur, p]));
    setQuery(null);
    area.current?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setPosting(true);
    // Only notify people whose @Name is still in the text.
    const mentions = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    await onPost(body, mentions);
    setText('');
    setPicked([]);
    setPosting(false);
  }

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t('panel.comments')}</h3>
      <ul className="space-y-3">
        {task.comments.map((c) => (
          <li key={c.id} className="group flex gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
              {c.author ? initials(c.author.name) : '?'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500">
                <span className="font-medium text-gray-800">{c.author?.name ?? t('panel.deletedUser')}</span> · {timeAgo(c.createdAt, locale)}
                {c.author?.id === meId && (
                  <button onClick={() => onDelete(c.id)} className="ms-2 text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100">
                    {t('board.delete')}
                  </button>
                )}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="relative mt-3">
        <textarea
          ref={area}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault();
              pick(suggestions[0]!);
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              void submit(e);
            }
          }}
          rows={3}
          placeholder={t('panel.commentPlaceholder')}
          aria-label={t('panel.writeComment')}
          className={input}
        />
        {suggestions.length > 0 && (
          <ul role="listbox" aria-label={t('composer.mention')} className="absolute bottom-full z-20 mb-1 w-64 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
            {suggestions.map((p) => (
              <li key={p.id} role="option" aria-selected="false">
                <button type="button" onClick={() => pick(p)} className="w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-gray-50">
                  {p.name} <span className="text-xs text-gray-400">{p.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="submit" disabled={posting || !text.trim()} className={`${btn.primary} mt-2`}>
          {posting ? t('composer.sending') : t('panel.comment')}
        </button>
      </form>
    </section>
  );
}
