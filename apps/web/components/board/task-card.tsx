'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { LabelDto, PersonDto, TaskCardDto } from '@workhub/shared';
import { useLocale, useT } from '@/lib/i18n';
import { dueLabel, hoursText, initials, LABEL_STYLES, PRIORITY_STYLE } from './style';

interface Props {
  task: TaskCardDto;
  labels: Map<string, LabelDto>;
  people: Map<string, PersonDto>;
  onOpen: (id: string) => void;
  draggable: boolean;
}

export function CardBody({ task, labels, people }: Omit<Props, 'onOpen' | 'draggable'>) {
  const t = useT();
  const locale = useLocale();
  const due = task.dueDate ? dueLabel(task.dueDate, task.completed, locale) : null;
  const cardLabels = task.labelIds.map((id) => labels.get(id)).filter((l): l is LabelDto => !!l);
  return (
    <>
      {cardLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {cardLabels.map((l) => (
            <span key={l.id} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${LABEL_STYLES[l.color]}`}>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <p className={`text-sm ${task.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-gray-500">
        {PRIORITY_STYLE[task.priority] && (
          <span className={`rounded px-1.5 py-0.5 font-medium ${PRIORITY_STYLE[task.priority]}`}>{t(`priority.${task.priority}`)}</span>
        )}
        {due && <span className={due.overdue ? 'font-medium text-red-600' : ''}>{due.text}</span>}
        {task.checklistTotal > 0 && (
          <span aria-label={t('board.checklistOf', { done: task.checklistDone, total: task.checklistTotal })}>
            ☑ {task.checklistDone}/{task.checklistTotal}
          </span>
        )}
        {task.subtasksTotal > 0 && (
          <span aria-label={t('board.subtasksOf', { done: task.subtasksDone, total: task.subtasksTotal })}>
            ↳ {task.subtasksDone}/{task.subtasksTotal}
          </span>
        )}
        {task.commentCount > 0 && <span aria-label={task.commentCount === 1 ? t('board.comments.one') : t('board.comments.many', { n: task.commentCount })}>💬 {task.commentCount}</span>}
        {(task.actualHours > 0 || task.estimateHours !== null) && (
          <span
            className={task.estimateHours !== null && task.actualHours > task.estimateHours ? 'font-medium text-red-600' : ''}
            aria-label={
              task.estimateHours !== null
                ? t('board.loggedOf', { hours: hoursText(task.actualHours, locale), estimate: hoursText(task.estimateHours, locale) })
                : t('projects.logged', { hours: hoursText(task.actualHours, locale) })
            }
          >
            ⏱ {task.actualHours > 0 ? hoursText(task.actualHours, locale) : hoursText(0, locale)}
            {task.estimateHours !== null && `/${hoursText(task.estimateHours, locale)}`}
          </span>
        )}
        {task.assigneeIds.length > 0 && (
          <span className="ms-auto flex -space-x-1.5">
            {task.assigneeIds.slice(0, 3).map((id) => {
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
      </div>
    </>
  );
}

/** A board card. Click (or Enter) opens it; drag (or Space then arrows) moves it. */
export function TaskCard({ task, labels, people, onOpen, draggable }: Props) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="button"
      aria-roledescription={draggable ? t('board.draggable') : undefined}
      aria-label={task.title}
      tabIndex={0}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(task.id);
        else listeners?.onKeyDown?.(e);
      }}
      className={`cursor-pointer select-none rounded-xl border border-gray-200 bg-white p-3 shadow-sm outline-none hover:border-gray-300 focus-visible:ring-2 focus-visible:ring-brand-500 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <CardBody task={task} labels={labels} people={people} />
    </div>
  );
}
