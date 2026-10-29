'use client';

import type { BoardDto, TaskCardDto } from '@workhub/shared';
import { useState } from 'react';
import { btn } from '@/components/ui';
import { useLocale, useT } from '@/lib/i18n';
import { addDays, addMonths, daysBetween, dayMonth, monthGrid, monthTitle, weekdayShort } from './dates';
import { localToday, PRIORITY_STYLE } from './style';

interface Props {
  board: BoardDto;
  tasks: Record<string, TaskCardDto>;
  onOpen: (id: string) => void;
  /** Moves a task's dates; the caller saves it. */
  onReschedule: (task: TaskCardDto, startDate: string | null, dueDate: string | null) => void;
}

/** The day a task shows on: its due date, or its start when it has no due date. */
const dayOf = (t: TaskCardDto) => t.dueDate ?? t.startDate;

/** A month of tasks by due date. Drag a task to another day to move it (its length stays the same). */
export function CalendarView({ board, tasks, onOpen, onReschedule }: Props) {
  const today = localToday();
  const tr = useT();
  const locale = useLocale();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const weeks = monthGrid(month);
  const list = Object.values(tasks);
  const byDay = new Map<string, TaskCardDto[]>();
  for (const t of list) {
    const d = dayOf(t);
    if (d) byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  const unscheduled = list.filter((t) => !dayOf(t) && !t.completed);

  function drop(day: string) {
    const t = dragging ? tasks[dragging] : undefined;
    setDragging(null);
    setOver(null);
    const from = t && dayOf(t);
    if (!t || !from || from === day) return;
    const shift = daysBetween(from, day);
    onReschedule(t, t.startDate ? addDays(t.startDate, shift) : null, t.dueDate ? addDays(t.dueDate, shift) : null);
  }

  const chip = (t: TaskCardDto) => (
    <button
      key={t.id}
      type="button"
      draggable={board.canEdit}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        setDragging(t.id);
      }}
      onDragEnd={() => setDragging(null)}
      onClick={() => onOpen(t.id)}
      title={t.title}
      className={`block w-full truncate rounded px-1.5 py-0.5 text-start text-xs ${
        t.completed ? 'bg-gray-100 text-gray-400 line-through' : t.dueDate && t.dueDate < today ? 'bg-red-50 text-red-700' : (PRIORITY_STYLE[t.priority] ?? 'bg-brand-50 text-brand-800')
      } ${board.canEdit ? 'cursor-grab' : ''}`}
    >
      {t.title}
    </button>
  );

  const inMonth = weeks.flat().filter((d) => d.startsWith(month));

  return (
    <div className="pe-4 lg:pe-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-lg font-semibold">{monthTitle(month, locale)}</h2>
        <button type="button" className={btn.secondary} onClick={() => setMonth(addMonths(month, -1))} aria-label={tr('leave.calendar.prev')}>
          <span className="inline-block rtl:rotate-180" aria-hidden="true">
            ‹
          </span>
        </button>
        <button type="button" className={btn.secondary} onClick={() => setMonth(today.slice(0, 7))}>
          {tr('time.today')}
        </button>
        <button type="button" className={btn.secondary} onClick={() => setMonth(addMonths(month, 1))} aria-label={tr('leave.calendar.next')}>
          <span className="inline-block rtl:rotate-180" aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      {/* The month grid on wider screens. */}
      <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white sm:block" role="grid" aria-label={monthTitle(month, locale)}>
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-center text-xs font-medium text-gray-500" role="row">
          {weeks[0]!.map((d) => (
            <div key={d} className="py-2" role="columnheader">
              {weekdayShort(d, locale)}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7" role="row">
            {week.map((day) => {
              const items = byDay.get(day) ?? [];
              const outside = !day.startsWith(month);
              return (
                <div
                  key={day}
                  role="gridcell"
                  aria-label={`${dayMonth(day, locale)}, ${items.length === 1 ? tr('board.tasks.one') : tr('board.tasks.many', { n: items.length })}`}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    setOver(day);
                  }}
                  onDragLeave={() => setOver((o) => (o === day ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(day);
                  }}
                  className={`min-h-24 border-b border-e border-gray-100 p-1.5 ${outside ? 'bg-gray-50/60' : ''} ${over === day ? 'bg-brand-50' : ''}`}
                >
                  <p className={`mb-1 text-xs ${day === today ? 'inline-grid h-5 w-5 place-items-center rounded-full bg-brand-600 font-semibold text-white' : outside ? 'text-gray-400' : 'text-gray-600'}`}>{Number(day.slice(8))}</p>
                  <div className="space-y-0.5">
                    {items.slice(0, 4).map(chip)}
                    {items.length > 4 && <p className="px-1.5 text-[11px] text-gray-500">{tr('board.more', { n: items.length - 4 })}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Phones: the month as a list of days with tasks. */}
      <ul className="space-y-3 sm:hidden">
        {inMonth.filter((d) => byDay.has(d)).length === 0 && <li className="text-sm text-gray-500">{tr('board.nothingThisMonth')}</li>}
        {inMonth
          .filter((d) => byDay.has(d))
          .map((d) => (
            <li key={d}>
              <p className={`text-xs font-semibold ${d === today ? 'text-brand-700' : 'text-gray-500'}`}>
                {weekdayShort(d, locale)} {dayMonth(d, locale)}
              </p>
              <div className="mt-1 space-y-1">{byDay.get(d)!.map(chip)}</div>
            </li>
          ))}
      </ul>

      {unscheduled.length > 0 && (
        <p className="mt-3 text-sm text-gray-500">
          {unscheduled.length === 1 ? tr('board.undated.one') : tr('board.undated.many', { n: unscheduled.length })}
        </p>
      )}
      {board.canEdit && <p className="mt-1 hidden text-xs text-gray-400 sm:block">{tr('board.calendarHint')}</p>}
    </div>
  );
}
