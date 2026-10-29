'use client';

import type { BoardDto, TaskCardDto } from '@workhub/shared';
import { useRef, useState } from 'react';
import { btn } from '@/components/ui';
import { addDays, dayMonth, daysBetween, mondayOf, span } from './dates';
import { localToday } from './style';

const DAY = 28; // pixels per day
const DAYS = 42; // six weeks on screen

interface Props {
  board: BoardDto;
  tasks: Record<string, TaskCardDto>;
  onOpen: (id: string) => void;
  onReschedule: (task: TaskCardDto, startDate: string | null, dueDate: string | null) => void;
}

type Drag = { id: string; mode: 'move' | 'start' | 'end'; x: number; from: string; to: string; shift: number };

/** What a drag does to a task's span: the whole bar moves, or one end. */
function dragged(d: Drag): { from: string; to: string } {
  if (d.mode === 'move') return { from: addDays(d.from, d.shift), to: addDays(d.to, d.shift) };
  if (d.mode === 'start') {
    const from = addDays(d.from, d.shift);
    return { from: from > d.to ? d.to : from, to: d.to };
  }
  const to = addDays(d.to, d.shift);
  return { from: d.from, to: to < d.from ? d.from : to };
}

/** A Gantt chart of the board: each task from its start to its due date, by column. */
export function TimelineView({ board, tasks, onOpen, onReschedule }: Props) {
  const today = localToday();
  const [start, setStart] = useState(addDays(mondayOf(today), -7));
  const [drag, setDrag] = useState<Drag | null>(null);
  const moved = useRef(false);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  const end = days.at(-1)!;
  const list = Object.values(tasks);
  const unscheduled = list.filter((t) => !span(t) && !t.completed);

  function begin(e: React.PointerEvent, t: TaskCardDto, mode: Drag['mode']) {
    const s = span(t);
    if (!board.canEdit || !s) return;
    e.stopPropagation();
    try {
      // Keeps the drag going when the pointer leaves the bar; it can fail if the pointer is already gone.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the container still sees the moves */
    }
    moved.current = false;
    setDrag({ id: t.id, mode, x: e.clientX, from: s.from, to: s.to, shift: 0 });
  }

  function move(e: React.PointerEvent) {
    if (!drag) return;
    const shift = Math.round((e.clientX - drag.x) / DAY);
    if (shift !== 0) moved.current = true;
    if (shift !== drag.shift) setDrag({ ...drag, shift });
  }

  function finish() {
    if (!drag) return;
    const t = tasks[drag.id];
    const next = dragged(drag);
    setDrag(null);
    if (!t || drag.shift === 0) return;
    // A task with one date keeps one date when it's only moved.
    if (next.from === next.to && !(t.startDate && t.dueDate)) {
      onReschedule(t, t.startDate ? next.from : null, t.dueDate ? next.to : null);
    } else {
      onReschedule(t, next.from, next.to);
    }
  }

  const groups = board.columns
    .map((c) => ({
      column: c,
      rows: list
        .filter((t) => t.columnId === c.id && span(t))
        .sort((a, b) => (span(a)!.from < span(b)!.from ? -1 : span(a)!.from > span(b)!.from ? 1 : a.position - b.position)),
    }))
    .filter((g) => g.rows.length > 0);
  const todayOffset = daysBetween(start, today);

  return (
    <div className="pr-4 lg:pr-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">
          {dayMonth(start)} – {dayMonth(end)}
        </h2>
        <button type="button" className={btn.secondary} onClick={() => setStart(addDays(start, -14))} aria-label="Two weeks earlier">
          ‹
        </button>
        <button type="button" className={btn.secondary} onClick={() => setStart(addDays(mondayOf(today), -7))}>
          Today
        </button>
        <button type="button" className={btn.secondary} onClick={() => setStart(addDays(start, 14))} aria-label="Two weeks later">
          ›
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-600">No tasks have dates yet. Open a task and give it a start and due date to see it here.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white" onPointerMove={move} onPointerUp={finish} onPointerCancel={() => setDrag(null)}>
          <div style={{ width: 224 + DAYS * DAY }} className="relative select-none">
            {/* Dates */}
            <div className="sticky top-0 z-10 flex border-b border-gray-200 bg-gray-50 text-[11px] text-gray-500">
              <div className="sticky left-0 z-10 w-56 shrink-0 border-r border-gray-200 bg-gray-50 px-3 py-2 font-medium">Task</div>
              {days.map((d) => {
                const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                return (
                  <div key={d} style={{ width: DAY }} className={`shrink-0 py-1 text-center ${dow === 0 || dow === 6 ? 'bg-gray-100' : ''} ${d === today ? 'font-semibold text-brand-700' : ''}`}>
                    {dow === 1 && <div className="truncate">{dayMonth(d)}</div>}
                    {dow !== 1 && <div>&nbsp;</div>}
                    <div>{Number(d.slice(8))}</div>
                  </div>
                );
              })}
            </div>

            {groups.map((g) => (
              <div key={g.column.id} role="rowgroup" aria-label={g.column.name}>
                <div className="sticky left-0 w-56 border-b border-gray-100 bg-white px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.column.name}</div>
                {g.rows.map((t) => {
                  const s = drag?.id === t.id ? dragged(drag) : span(t)!;
                  const left = daysBetween(start, s.from) * DAY;
                  const width = (daysBetween(s.from, s.to) + 1) * DAY;
                  const visible = s.to >= start && s.from <= end;
                  const late = !t.completed && !!t.dueDate && t.dueDate < today;
                  return (
                    <div key={t.id} className="flex h-9 items-center border-b border-gray-50">
                      <button
                        type="button"
                        onClick={() => onOpen(t.id)}
                        className={`sticky left-0 z-[5] h-full w-56 shrink-0 truncate border-r border-gray-200 bg-white px-3 text-left text-sm hover:bg-gray-50 ${t.completed ? 'text-gray-400 line-through' : ''}`}
                        title={t.title}
                      >
                        {t.title}
                      </button>
                      <div className="relative h-full" style={{ width: DAYS * DAY }}>
                        {visible && (
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={`${t.title}: ${dayMonth(s.from)} to ${dayMonth(s.to)}`}
                            onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}
                            onPointerDown={(e) => begin(e, t, 'move')}
                            onClick={() => !moved.current && onOpen(t.id)}
                            style={{ left, width }}
                            className={`absolute top-1.5 flex h-6 items-center rounded-md text-[11px] font-medium text-white shadow-sm ${
                              t.completed ? 'bg-gray-300' : late ? 'bg-red-500' : 'bg-brand-500'
                            } ${board.canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${drag?.id === t.id ? 'ring-2 ring-brand-200' : ''}`}
                          >
                            {board.canEdit && <span onPointerDown={(e) => begin(e, t, 'start')} className="h-full w-2 shrink-0 cursor-ew-resize rounded-l-md hover:bg-black/10" aria-hidden="true" />}
                            <span className="min-w-0 flex-1 truncate px-1">{width > 3 * DAY ? t.title : ''}</span>
                            {board.canEdit && <span onPointerDown={(e) => begin(e, t, 'end')} className="h-full w-2 shrink-0 cursor-ew-resize rounded-r-md hover:bg-black/10" aria-hidden="true" />}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Today */}
            {todayOffset >= 0 && todayOffset < DAYS && <div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 w-px bg-brand-600/60" style={{ left: 224 + todayOffset * DAY + DAY / 2 }} />}
          </div>
        </div>
      )}

      {unscheduled.length > 0 && (
        <p className="mt-3 text-sm text-gray-500">
          {unscheduled.length} open {unscheduled.length === 1 ? 'task has' : 'tasks have'} no dates and {unscheduled.length === 1 ? 'isn’t' : 'aren’t'} shown.
        </p>
      )}
      {board.canEdit && <p className="mt-1 text-xs text-gray-400">Drag a bar to move it, or its ends to change the start or due date.</p>}
    </div>
  );
}
