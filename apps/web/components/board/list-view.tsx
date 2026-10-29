'use client';

import { PRIORITIES, type BoardDto, type BulkTasksInput, type LabelDto, type PersonDto, type Priority, type TaskCardDto } from '@workhub/shared';
import { useEffect, useMemo, useState } from 'react';
import { btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';
import { dueLabel, hoursText, initials, LABEL_STYLES, localToday, PRIORITY_STYLE } from './style';

type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none';

interface Filters {
  search: string;
  columnId: string;
  assignee: string; // '' any · 'me' · 'none' · a user id
  labelId: string;
  priority: '' | Priority;
  due: DueFilter;
  showCompleted: boolean;
}

const NO_FILTERS: Filters = { search: '', columnId: '', assignee: '', labelId: '', priority: '', due: 'any', showCompleted: false };

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  board: BoardDto;
  tasks: Record<string, TaskCardDto>;
  onOpen: (taskId: string) => void;
  onError: (message: string) => void;
}

/** Every top-level card in one sortable, filterable table, with bulk edit for the selected rows. */
export function ListView({ board, tasks, onOpen, onError }: Props) {
  const api = useWorkspaceApi();
  const tr = useT();
  const locale = useLocale();
  const { me } = useWorkspace();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const labels = useMemo(() => new Map<string, LabelDto>(board.labels.map((l) => [l.id, l])), [board.labels]);
  const people = useMemo(() => new Map<string, PersonDto>(board.people.map((p) => [p.id, p])), [board.people]);
  const columnIndex = useMemo(() => new Map(board.columns.map((c, i) => [c.id, i])), [board.columns]);
  const columnName = useMemo(() => new Map(board.columns.map((c) => [c.id, c.name])), [board.columns]);

  const rows = useMemo(() => {
    const today = localToday();
    const weekEnd = addDays(today, 7);
    const q = filters.search.trim().toLowerCase();
    return Object.values(tasks)
      .filter((t) => {
        if (!filters.showCompleted && t.completed) return false;
        if (q && !t.title.toLowerCase().includes(q)) return false;
        if (filters.columnId && t.columnId !== filters.columnId) return false;
        if (filters.labelId && !t.labelIds.includes(filters.labelId)) return false;
        if (filters.priority && t.priority !== filters.priority) return false;
        if (filters.assignee === 'me' && !t.assigneeIds.includes(me.user.id)) return false;
        if (filters.assignee === 'none' && t.assigneeIds.length > 0) return false;
        if (filters.assignee && !['me', 'none'].includes(filters.assignee) && !t.assigneeIds.includes(filters.assignee)) return false;
        switch (filters.due) {
          case 'overdue':
            return !!t.dueDate && t.dueDate < today && !t.completed;
          case 'today':
            return t.dueDate === today;
          case 'week':
            return !!t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd;
          case 'none':
            return !t.dueDate;
          default:
            return true;
        }
      })
      .sort((a, b) => (columnIndex.get(a.columnId) ?? 0) - (columnIndex.get(b.columnId) ?? 0) || a.position - b.position);
  }, [tasks, filters, me.user.id, columnIndex]);

  // Forget selections that were deleted or filtered away.
  useEffect(() => {
    setSelected((cur) => {
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...cur].filter((id) => visible.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [rows]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function bulk(action: BulkTasksInput['action']) {
    if (selected.size === 0) return;
    if (action.type === 'delete' && !window.confirm(selected.size === 1 ? tr('list.confirmDelete.one') : tr('list.confirmDelete.many', { n: selected.size }))) return;
    setBusy(true);
    try {
      // The board's live events bring the changes in, for this tab and everyone else's.
      await api(`/projects/${board.project.id}/tasks/bulk`, { method: 'POST', body: { taskIds: [...selected], action } });
      if (action.type === 'delete') setSelected(new Set());
    } catch (err) {
      onError(err instanceof ApiError ? err.message : tr('list.bulkFailed'));
    } finally {
      setBusy(false);
    }
  }

  const select = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm';

  return (
    <div className={`pe-4 lg:pe-8 ${selected.size > 0 ? 'pb-28' : ''}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="search" aria-label={tr('list.filter')}>
        <input
          type="search"
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder={tr('list.search')}
          aria-label={tr('list.search')}
          className={`${input} max-w-56 !py-1.5`}
        />
        <select aria-label={tr('list.column')} value={filters.columnId} onChange={(e) => set('columnId', e.target.value)} className={select}>
          <option value="">{tr('list.allColumns')}</option>
          {board.columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label={tr('list.assignee')} value={filters.assignee} onChange={(e) => set('assignee', e.target.value)} className={select}>
          <option value="">{tr('list.anyone')}</option>
          <option value="me">{tr('list.assignedToMe')}</option>
          <option value="none">{tr('list.unassigned')}</option>
          {board.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select aria-label={tr('list.label')} value={filters.labelId} onChange={(e) => set('labelId', e.target.value)} className={select}>
          <option value="">{tr('list.anyLabel')}</option>
          {board.labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select aria-label={tr('list.priority')} value={filters.priority} onChange={(e) => set('priority', e.target.value as Filters['priority'])} className={select}>
          <option value="">{tr('list.anyPriority')}</option>
          {[...PRIORITIES].reverse().map((p) => (
            <option key={p} value={p}>
              {tr(`priority.${p}`)}
            </option>
          ))}
        </select>
        <select aria-label={tr('list.dueDate')} value={filters.due} onChange={(e) => set('due', e.target.value as DueFilter)} className={select}>
          <option value="any">{tr('list.anyDue')}</option>
          <option value="overdue">{tr('myWork.group.overdue')}</option>
          <option value="today">{tr('list.dueToday')}</option>
          <option value="week">{tr('list.dueWeek')}</option>
          <option value="none">{tr('myWork.group.none')}</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={filters.showCompleted} onChange={(e) => set('showCompleted', e.target.checked)} />
          Show completed
        </label>
        {filtered && (
          <button type="button" className={btn.ghost} onClick={() => setFilters(NO_FILTERS)}>
            {tr('list.clearFilters')}
          </button>
        )}
      </div>

      {board.canEdit && selected.size > 0 && <BulkBar board={board} count={selected.size} busy={busy} onAction={bulk} onClear={() => setSelected(new Set())} />}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-start text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              {board.canEdit && (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={tr('list.selectAll')}
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
              <th className="px-3 py-2">{tr('board.timeline.task')}</th>
              <th className="px-3 py-2">{tr('list.column')}</th>
              <th className="px-3 py-2">{tr('list.assignees')}</th>
              <th className="px-3 py-2">{tr('list.priority')}</th>
              <th className="px-3 py-2">{tr('list.due')}</th>
              <th className="px-3 py-2 text-end">{tr('list.hours')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const due = t.dueDate ? dueLabel(t.dueDate, t.completed, locale) : null;
              const over = t.estimateHours !== null && t.actualHours > t.estimateHours;
              return (
                <tr key={t.id} className={`border-b border-gray-100 last:border-0 ${selected.has(t.id) ? 'bg-brand-50/60' : 'hover:bg-gray-50'}`}>
                  {board.canEdit && (
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={tr('list.select', { title: t.title })} checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(t.id)}
                      className={`text-start hover:underline ${t.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}
                    >
                      {t.title}
                    </button>
                    {t.labelIds.length > 0 && (
                      <span className="ms-2 inline-flex flex-wrap gap-1 align-middle">
                        {t.labelIds.map((id) => {
                          const l = labels.get(id);
                          return l ? (
                            <span key={id} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${LABEL_STYLES[l.color]}`}>
                              {l.name}
                            </span>
                          ) : null;
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{columnName.get(t.columnId)}</td>
                  <td className="px-3 py-2">
                    {t.assigneeIds.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className="flex -space-x-1.5">
                        {t.assigneeIds.slice(0, 4).map((id) => {
                          const p = people.get(id);
                          return (
                            <span
                              key={id}
                              title={p?.name}
                              className="grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-brand-100 text-[10px] font-semibold text-brand-700"
                            >
                              {p ? initials(p.name) : '?'}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {t.priority === 'none' ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLE[t.priority] ?? 'text-gray-600'}`}>
                        {tr(`priority.${t.priority}`)}
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 ${due?.overdue ? 'font-medium text-red-600' : 'text-gray-600'}`}>{due?.text ?? <span className="text-gray-400">—</span>}</td>
                  <td className={`px-3 py-2 text-end tabular-nums ${over ? 'font-medium text-red-600' : 'text-gray-600'}`}>
                    {t.actualHours > 0 || t.estimateHours !== null ? (
                      <>
                        {hoursText(t.actualHours, locale)}
                        {t.estimateHours !== null && <span className="text-gray-400"> / {hoursText(t.estimateHours, locale)}</span>}
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-500">
                  {filtered ? tr('list.noMatch') : tr('list.noTasks')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500" role="status">
        {rows.length === 1 ? tr('list.shown.one') : tr('list.shown.many', { n: rows.length })}
        {selected.size > 0 && ` · ${tr('list.selected', { n: selected.size })}`}
      </p>
    </div>
  );
}

function BulkBar({
  board,
  count,
  busy,
  onAction,
  onClear,
}: {
  board: BoardDto;
  count: number;
  busy: boolean;
  onAction: (action: BulkTasksInput['action']) => void;
  onClear: () => void;
}) {
  const tr = useT();
  const [due, setDue] = useState('');
  const select = 'rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm disabled:opacity-60';
  // Each menu fires once on choice, then resets to its placeholder.
  const pick = (e: React.ChangeEvent<HTMLSelectElement>, make: (v: string) => BulkTasksInput['action']) => {
    const v = e.target.value;
    e.target.value = '';
    if (v) onAction(make(v));
  };
  return (
    // Floats over the bottom of the screen, so the table never shifts under the pointer while selecting.
    <div
      className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm shadow-lg lg:start-64"
      role="toolbar"
      aria-label={tr('list.bulk')}
    >
      <span className="font-medium text-brand-800">{tr('list.selected', { n: count })}</span>
      <select aria-label={tr('list.moveToColumn')} disabled={busy} className={select} defaultValue="" onChange={(e) => pick(e, (columnId) => ({ type: 'move', columnId }))}>
        <option value="">{tr('list.moveTo')}</option>
        {board.columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select aria-label={tr('list.assignTo')} disabled={busy} className={select} defaultValue="" onChange={(e) => pick(e, (userId) => ({ type: 'assign', userId }))}>
        <option value="">{tr('list.assign')}</option>
        {board.people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select aria-label={tr('list.unassign')} disabled={busy} className={select} defaultValue="" onChange={(e) => pick(e, (userId) => ({ type: 'unassign', userId }))}>
        <option value="">{tr('list.unassignMenu')}</option>
        {board.people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select aria-label={tr('list.setPriority')} disabled={busy} className={select} defaultValue="" onChange={(e) => pick(e, (p) => ({ type: 'priority', priority: p as Priority }))}>
        <option value="">{tr('list.priorityMenu')}</option>
        {[...PRIORITIES].reverse().map((p) => (
          <option key={p} value={p}>
            {tr(`priority.${p}`)}
          </option>
        ))}
      </select>
      {board.labels.length > 0 && (
        <select aria-label={tr('list.addLabel')} disabled={busy} className={select} defaultValue="" onChange={(e) => pick(e, (labelId) => ({ type: 'label', labelId }))}>
          <option value="">{tr('list.addLabelMenu')}</option>
          {board.labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      <span className="flex items-center gap-1">
        <input type="date" aria-label={tr('list.dueDate')} value={due} onChange={(e) => setDue(e.target.value)} className={select} />
        <button type="button" disabled={busy || !due} className={btn.ghost} onClick={() => onAction({ type: 'due', dueDate: due })}>
          {tr('list.setDue')}
        </button>
        <button type="button" disabled={busy} className={btn.ghost} onClick={() => onAction({ type: 'due', dueDate: null })}>
          {tr('list.clearDue')}
        </button>
      </span>
      <button type="button" disabled={busy} className={btn.ghost} onClick={() => onAction({ type: 'complete', completed: true })}>
        {tr('list.markDone')}
      </button>
      <button type="button" disabled={busy} className={btn.ghost} onClick={() => onAction({ type: 'complete', completed: false })}>
        {tr('list.reopen')}
      </button>
      <button type="button" disabled={busy} className={btn.danger} onClick={() => onAction({ type: 'delete' })}>
        {tr('board.delete')}
      </button>
      <button type="button" className={`${btn.ghost} ms-auto`} onClick={onClear}>
        {tr('list.clearSelection')}
      </button>
    </div>
  );
}
