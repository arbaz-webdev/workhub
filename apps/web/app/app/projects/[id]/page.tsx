'use client';

import type { BoardDto, BoardEvent, ColumnDto, TaskCardDto } from '@workhub/shared';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Board } from '@/components/board/board';
import { CalendarView } from '@/components/board/calendar-view';
import { TimelineView } from '@/components/board/timeline-view';
import { ListView } from '@/components/board/list-view';
import { hoursText } from '@/components/board/style';
import { TaskPanel } from '@/components/board/task-panel';
import { useBoardEvents } from '@/components/board/use-board-events';
import { Alert, btn } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const VIEWS = ['board', 'list', 'calendar', 'timeline'] as const;
type View = (typeof VIEWS)[number];

export default function ProjectBoardPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading board…</p>}>
      <ProjectBoard />
    </Suspense>
  );
}

function ProjectBoard() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [board, setBoard] = useState<BoardDto>();
  const [tasks, setTasks] = useState<Record<string, TaskCardDto>>({});
  const [error, setError] = useState<string>();
  const [notFound, setNotFound] = useState(false);
  const [taskVersion, setTaskVersion] = useState(0);
  const [notice, setNotice] = useState<string>();
  const openTaskId = params.get('task');
  const view = VIEWS.find((v) => v === params.get('view')) ?? 'board';

  const load = useCallback(() => {
    api<BoardDto>(`/projects/${id}`)
      .then((b) => {
        setBoard(b);
        setTasks(Object.fromEntries(b.tasks.map((t) => [t.id, t])));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError('Could not load the board.');
      });
  }, [api, id]);

  useEffect(load, [load]);

  const onEvent = useCallback(
    (event: BoardEvent) => {
      switch (event.type) {
        case 'task.upserted':
          setTasks((cur) => ({ ...cur, [event.task.id]: event.task }));
          break;
        case 'task.deleted':
          setTasks(({ [event.taskId]: _gone, ...rest }) => rest);
          break;
        case 'task.changed':
          if (event.taskId === openTaskId) setTaskVersion((v) => v + 1);
          break;
        case 'columns.changed':
          setBoard((b) => (b ? { ...b, columns: event.columns } : b));
          break;
        case 'labels.changed':
          setBoard((b) => (b ? { ...b, labels: event.labels } : b));
          break;
        case 'project.changed':
          load();
          break;
      }
    },
    [openTaskId, load],
  );

  const live = useBoardEvents(id, workspace.id, onEvent, load);

  // The URL holds the view and the open task, so both survive reloads and can be shared.
  const go = useCallback(
    (next: { view?: View; task?: string | null }) => {
      const q = new URLSearchParams();
      const v = next.view ?? view;
      if (v !== 'board') q.set('view', v);
      const t = next.task === undefined ? openTaskId : next.task;
      if (t) q.set('task', t);
      const qs = q.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, view, openTaskId],
  );
  const openTask = (taskId: string) => go({ task: taskId });
  const closeTask = useCallback(() => go({ task: null }), [go]);
  const showError = useCallback((m: string) => {
    setError(m);
    setTimeout(() => setError(undefined), 6000);
  }, []);

  /** Moves a task's dates from the calendar or timeline: shown at once, saved, and put back if it fails. */
  async function reschedule(task: TaskCardDto, startDate: string | null, dueDate: string | null) {
    setTasks((all) => ({ ...all, [task.id]: { ...task, startDate, dueDate } }));
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { startDate, dueDate } });
    } catch (err) {
      setTasks((all) => ({ ...all, [task.id]: task }));
      showError(err instanceof ApiError ? err.message : 'Could not move the task.');
    }
  }

  async function saveAsTemplate() {
    const name = window.prompt('Name this template', board ? `${board.project.name} template` : '');
    if (!name?.trim()) return;
    try {
      await api(`/projects/${id}/save-as-template`, { method: 'POST', body: { name: name.trim() } });
      setNotice(`Saved “${name.trim()}”. Pick it when you create a new project.`);
      setTimeout(() => setNotice(undefined), 6000);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Could not save the template.');
    }
  }

  if (notFound) {
    return (
      <Alert>
        This project doesn&apos;t exist or you don&apos;t have access. <Link href="/app/projects" className="underline">Back to projects</Link>
      </Alert>
    );
  }
  if (!board) return <p className="text-sm text-gray-500">{error ?? 'Loading board…'}</p>;

  const all = Object.values(tasks);
  const done = all.filter((t) => t.completed).length;
  const estimate = all.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0);
  // Cards include their subtasks' time, so this stays current as time is logged live.
  const actual = all.reduce((sum, t) => sum + t.actualHours, 0);
  const budget = board.project.budgetHours;
  const budgetUsed = budget ? actual / budget : 0;

  return (
    <div className="-me-4 lg:-me-8">
      <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-2 pe-4 lg:pe-8">
        <div>
          <p className="text-sm text-gray-500">
            <Link href="/app/projects" className="hover:underline">
              Projects
            </Link>{' '}
            / {board.project.client?.name ?? 'Internal'}
          </p>
          <h1 className="text-2xl font-semibold">{board.project.name}</h1>
        </div>
        <p className="text-sm text-gray-500">
          {done}/{all.length} done · {hoursText(actual)} logged
          {estimate > 0 && ` · ${hoursText(estimate)} estimated`}
        </p>
        {budget ? (
          <div className="w-44" title={`${hoursText(actual)} of ${hoursText(budget)} budget`}>
            <p className={`text-xs ${budgetUsed > 1 ? 'font-medium text-red-600' : budgetUsed >= 0.8 ? 'text-amber-700' : 'text-gray-500'}`}>
              {budgetUsed > 1 ? 'Over budget' : 'Budget'}: {hoursText(actual)} / {hoursText(budget)}
            </p>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200"
              role="progressbar"
              aria-label="Budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(budgetUsed * 100)}
            >
              <div
                className={`h-full rounded-full ${budgetUsed > 1 ? 'bg-red-500' : budgetUsed >= 0.8 ? 'bg-amber-500' : 'bg-brand-500'}`}
                style={{ width: `${Math.min(100, budgetUsed * 100)}%` }}
              />
            </div>
          </div>
        ) : null}
        <div className="ms-auto flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 text-sm" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => go({ view: v })}
                className={`rounded-md px-3 py-1 font-medium ${view === v ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                {{ board: 'Board', list: 'List', calendar: 'Calendar', timeline: 'Timeline' }[v]}
              </button>
            ))}
          </div>
          {board.canManage && (
            <button type="button" className={btn.ghost} onClick={saveAsTemplate}>
              Save as template
            </button>
          )}
        <span className={`flex items-center gap-1.5 text-xs ${live ? 'text-brand-700' : 'text-gray-400'}`} role="status">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live ? 'bg-brand-500' : 'bg-gray-300'}`} />
          {live ? 'Live' : 'Reconnecting…'}
        </span>
        </div>
      </div>

      {notice && (
        <div className="mb-4 pe-4 lg:pe-8">
          <Alert kind="success">{notice}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-4 pe-4 lg:pe-8">
          <Alert>{error}</Alert>
        </div>
      )}
      {!board.canEdit && (
        <p className="mb-4 text-sm text-gray-500">You can view this board and comment on tasks. Ask a manager if you need to make changes.</p>
      )}

      {view === 'list' ? (
        <ListView board={board} tasks={tasks} onOpen={openTask} onError={showError} />
      ) : view === 'calendar' ? (
        <CalendarView board={board} tasks={tasks} onOpen={openTask} onReschedule={(t, s, d) => void reschedule(t, s, d)} />
      ) : view === 'timeline' ? (
        <TimelineView board={board} tasks={tasks} onOpen={openTask} onReschedule={(t, s, d) => void reschedule(t, s, d)} />
      ) : (
        <Board
          board={board}
          tasks={tasks}
          setTasks={setTasks}
          setColumns={(columns: ColumnDto[]) => setBoard((b) => (b ? { ...b, columns } : b))}
          onOpen={openTask}
          onError={showError}
          reload={load}
        />
      )}

      {openTaskId && (
        <TaskPanel
          key={openTaskId}
          taskId={openTaskId}
          board={board}
          version={taskVersion}
          onClose={closeTask}
          onLabelsChanged={(labels) => setBoard((b) => (b ? { ...b, labels } : b))}
        />
      )}
    </div>
  );
}
