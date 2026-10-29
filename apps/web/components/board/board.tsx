'use client';

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { BoardDto, ColumnDto, LabelDto, PersonDto, TaskCardDto } from '@workhub/shared';
import { useMemo, useState } from 'react';
import { btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useWorkspaceApi } from '@/lib/workspace';
import { CardBody, TaskCard } from './task-card';

type Order = Record<string, string[]>;

/** Column → ordered task ids, from each card's column and position. */
function orderFrom(columns: ColumnDto[], tasks: Record<string, TaskCardDto>): Order {
  const order: Order = Object.fromEntries(columns.map((c) => [c.id, [] as string[]]));
  for (const t of Object.values(tasks).sort((a, b) => a.position - b.position)) order[t.columnId]?.push(t.id);
  return order;
}

/** A position between the neighbours at `index` (mirrors the server, for an instant optimistic update). */
function positionAt(ids: string[], index: number, tasks: Record<string, TaskCardDto>) {
  const before = ids[index - 1] ? tasks[ids[index - 1]!]!.position : undefined;
  const after = ids[index + 1] ? tasks[ids[index + 1]!]!.position : undefined;
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return after! - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}

interface Props {
  board: BoardDto;
  tasks: Record<string, TaskCardDto>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, TaskCardDto>>>;
  setColumns: (columns: ColumnDto[]) => void;
  onOpen: (taskId: string) => void;
  onError: (message: string) => void;
  reload: () => void;
}

export function Board({ board, tasks, setTasks, setColumns, onOpen, onError, reload }: Props) {
  const api = useWorkspaceApi();
  const t = useT();
  const labels = useMemo(() => new Map<string, LabelDto>(board.labels.map((l) => [l.id, l])), [board.labels]);
  const people = useMemo(() => new Map<string, PersonDto>(board.people.map((p) => [p.id, p])), [board.people]);
  const baseOrder = useMemo(() => orderFrom(board.columns, tasks), [board.columns, tasks]);
  // While dragging, a temporary order shows where the card will land.
  const [dragOrder, setDragOrder] = useState<Order | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const order = dragOrder ?? baseOrder;

  // Left/Right jump to the neighbouring column; Up/Down move within a column.
  const coordinateGetter = useMemo<KeyboardCoordinateGetter>(
    () => (event, args) => {
      if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return sortableKeyboardCoordinates(event, args);
      const { collisionRect, droppableRects } = args.context;
      if (!collisionRect) return undefined;
      event.preventDefault();
      const centre = collisionRect.left + collisionRect.width / 2;
      const rects = board.columns
        .map((c) => droppableRects.get(c.id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .sort((a, b) => a.left - b.left);
      const target =
        event.code === 'ArrowRight' ? rects.find((r) => r.left > centre) : [...rects].reverse().find((r) => r.left + r.width < centre);
      return target ? { x: target.left + 8, y: target.top + 8 } : undefined;
    },
    [board.columns],
  );

  // Screen readers hear task and column names, not internal ids.
  const nameOf = (id: UniqueIdentifier | undefined) => {
    if (id === undefined) return '';
    const key = String(id);
    return tasks[key]?.title ?? board.columns.find((c) => c.id === key)?.name ?? '';
  };
  const placeOf = (id: UniqueIdentifier | undefined) => {
    if (id === undefined) return t('board.dnd.nowhere');
    const key = String(id);
    const column = board.columns.find((c) => c.id === key || (dragOrder ?? baseOrder)[c.id]?.includes(key));
    return column ? t('board.dnd.column', { name: column.name }) : t('board.dnd.board');
  };
  const announcements = {
    onDragStart: ({ active }: { active: { id: UniqueIdentifier } }) => t('board.dnd.start', { name: nameOf(active.id) }),
    onDragOver: ({ active, over }: { active: { id: UniqueIdentifier }; over: { id: UniqueIdentifier } | null }) =>
      t('board.dnd.over', { name: nameOf(active.id), place: placeOf(over?.id) }),
    onDragEnd: ({ active, over }: { active: { id: UniqueIdentifier }; over: { id: UniqueIdentifier } | null }) =>
      over ? t('board.dnd.end', { name: nameOf(active.id), place: placeOf(over.id) }) : t('board.dnd.notMoved', { name: nameOf(active.id) }),
    onDragCancel: ({ active }: { active: { id: UniqueIdentifier } }) => t('board.dnd.cancel', { name: nameOf(active.id) }),
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // On touch screens a short press-and-hold picks a card up, so swiping still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter,
      // Enter opens a card, so only Space picks it up.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const columnOf = (id: string, o: Order) => (id in o ? id : Object.keys(o).find((c) => o[c]!.includes(id)));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setDragOrder(baseOrder);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || !dragOrder) return;
    const from = columnOf(String(active.id), dragOrder);
    const to = columnOf(String(over.id), dragOrder);
    if (!from || !to || from === to) return;
    setDragOrder((cur) => {
      if (!cur) return cur;
      const source = cur[from]!.filter((id) => id !== active.id);
      const target = [...cur[to]!];
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id));
      return { ...cur, [from]: source, [to]: target };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const current = dragOrder;
    setActiveId(null);
    setDragOrder(null);
    if (!current || !e.over) return;

    const column = columnOf(id, current)!;
    let ids = current[column]!;
    const overIndex = ids.indexOf(String(e.over.id));
    const fromIndex = ids.indexOf(id);
    if (overIndex >= 0 && overIndex !== fromIndex) ids = arrayMove(ids, fromIndex, overIndex);
    const index = ids.indexOf(id);
    const card = tasks[id]!;
    if (card.columnId === column && baseOrder[column]!.indexOf(id) === index) return; // no change

    // Optimistic: show it in place now; the server's answer (and live event) confirm it.
    const position = positionAt(ids, index, tasks);
    setTasks((cur) => ({ ...cur, [id]: { ...cur[id]!, columnId: column, position } }));
    try {
      const saved = await api<TaskCardDto>(`/tasks/${id}/move`, { method: 'POST', body: { columnId: column, index } });
      setTasks((cur) => ({ ...cur, [id]: saved }));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('board.moveFailed'));
      reload();
    }
  }

  const active = activeId ? tasks[activeId] : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t('board.dnd.instructions'),
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragOrder(null);
      }}
    >
      <div className="flex items-start gap-4 overflow-x-auto pb-4">
        {board.columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            ids={order[column.id] ?? []}
            tasks={tasks}
            labels={labels}
            people={people}
            board={board}
            onOpen={onOpen}
            onError={onError}
            setColumns={setColumns}
            onCreated={(task) => setTasks((cur) => ({ ...cur, [task.id]: task }))}
          />
        ))}
        {board.canManage && <AddColumn projectId={board.project.id} setColumns={setColumns} onError={onError} />}
      </div>
      <DragOverlay>
        {active ? (
          <div className="w-72 rotate-2 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
            <CardBody task={active} labels={labels} people={people} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column,
  ids,
  tasks,
  labels,
  people,
  board,
  onOpen,
  onError,
  setColumns,
  onCreated,
}: {
  column: ColumnDto;
  ids: string[];
  tasks: Record<string, TaskCardDto>;
  labels: Map<string, LabelDto>;
  people: Map<string, PersonDto>;
  board: BoardDto;
  onOpen: (id: string) => void;
  onError: (m: string) => void;
  setColumns: (c: ColumnDto[]) => void;
  onCreated: (t: TaskCardDto) => void;
}) {
  const api = useWorkspaceApi();
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const overLimit = column.wipLimit !== null && ids.length > column.wipLimit;

  async function addTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get('title') ?? '').trim();
    if (!title) return;
    try {
      onCreated(await api<TaskCardDto>(`/projects/${board.project.id}/tasks`, { method: 'POST', body: { title, columnId: column.id } }));
      form.reset();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('board.addTaskFailed'));
    }
  }

  async function saveColumn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const limit = String(form.get('wipLimit') ?? '').trim();
    try {
      setColumns(
        await api<ColumnDto[]>(`/projects/${board.project.id}/columns/${column.id}`, {
          method: 'PATCH',
          body: { name: String(form.get('name')).trim(), wipLimit: limit ? Number(limit) : null },
        }),
      );
      setEditing(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('board.saveColumnFailed'));
    }
  }

  async function deleteColumn() {
    if (!window.confirm(t('board.confirmDeleteColumn', { name: column.name }))) return;
    try {
      setColumns(await api<ColumnDto[]>(`/projects/${board.project.id}/columns/${column.id}`, { method: 'DELETE' }));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('board.deleteColumnFailed'));
    }
  }

  return (
    <section
      aria-label={column.name}
      className={`flex w-72 shrink-0 flex-col rounded-2xl p-2 ${isOver ? 'bg-brand-50' : 'bg-gray-100'}`}
    >
      {editing ? (
        <form onSubmit={saveColumn} className="mb-2 space-y-2 rounded-xl bg-white p-2">
          <input name="name" defaultValue={column.name} aria-label={t('board.columnName')} className={input} autoFocus />
          <input
            name="wipLimit"
            type="number"
            min="1"
            defaultValue={column.wipLimit ?? ''}
            placeholder={t('board.wipOptional')}
            aria-label={t('board.wip')}
            className={input}
          />
          <div className="flex gap-2">
            <button type="submit" className={btn.primary}>
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={btn.ghost}>
              {t('common.cancel')}
            </button>
            <button type="button" onClick={deleteColumn} className={`${btn.danger} ms-auto`}>
              {t('board.delete')}
            </button>
          </div>
        </form>
      ) : (
        <header className="mb-2 flex items-center gap-2 px-1.5 pt-1">
          <h2 className="text-sm font-semibold text-gray-700">{column.name}</h2>
          <span className={`text-xs ${overLimit ? 'font-semibold text-amber-700' : 'text-gray-400'}`}>
            {ids.length}
            {column.wipLimit !== null ? ` / ${column.wipLimit}` : ''}
          </span>
          {board.canManage && (
            <button
              onClick={() => setEditing(true)}
              aria-label={t('board.editColumn', { name: column.name })}
              className="ms-auto rounded px-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
            >
              ⋯
            </button>
          )}
        </header>
      )}

      <SortableContext id={column.id} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-[3rem] flex-col gap-2">
          {ids.map((id) =>
            tasks[id] ? (
              <TaskCard key={id} task={tasks[id]!} labels={labels} people={people} onOpen={onOpen} draggable={board.canEdit} />
            ) : null,
          )}
        </div>
      </SortableContext>

      {board.canEdit &&
        (adding ? (
          <form onSubmit={addTask} className="mt-2">
            <input
              name="title"
              autoFocus
              placeholder={t('board.taskPlaceholder')}
              aria-label={t('board.newTaskIn', { name: column.name })}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
              onBlur={(e) => !e.currentTarget.value && setAdding(false)}
              className={input}
            />
          </form>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-2 rounded-lg px-2 py-1.5 text-start text-sm text-gray-500 hover:bg-gray-200 hover:text-gray-800"
          >
            {t('board.addTask')}
          </button>
        ))}
    </section>
  );
}

function AddColumn({ projectId, setColumns, onError }: { projectId: string; setColumns: (c: ColumnDto[]) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const t = useT();
  const [open, setOpen] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    try {
      setColumns(await api<ColumnDto[]>(`/projects/${projectId}/columns`, { method: 'POST', body: { name } }));
      setOpen(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('board.addColumnFailed'));
    }
  }

  return open ? (
    <form onSubmit={onSubmit} className="w-72 shrink-0 rounded-2xl bg-gray-100 p-2">
      <input name="name" autoFocus placeholder={t('board.columnName')} aria-label={t('board.newColumnName')} className={input} />
      <div className="mt-2 flex gap-2">
        <button type="submit" className={btn.primary}>
          {t('board.addColumnSubmit')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btn.ghost}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="w-72 shrink-0 rounded-2xl border-2 border-dashed border-gray-200 px-3 py-3 text-start text-sm text-gray-500 hover:border-gray-300 hover:text-gray-700"
    >
      {t('board.addColumn')}
    </button>
  );
}
