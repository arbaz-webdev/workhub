'use client';

import type { BoardDto, BoardEvent, ColumnDto, TaskCardDto } from '@workhub/shared';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Board } from '@/components/board/board';
import { TaskPanel } from '@/components/board/task-panel';
import { useBoardEvents } from '@/components/board/use-board-events';
import { Alert } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

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
  const openTaskId = params.get('task');

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

  const openTask = (taskId: string) => router.push(`${pathname}?task=${taskId}`, { scroll: false });
  const closeTask = useCallback(() => router.push(pathname, { scroll: false }), [router, pathname]);

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

  return (
    <div className="-mr-4 lg:-mr-8">
      <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-2 pr-4 lg:pr-8">
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
          {done}/{all.length} done
          {estimate > 0 && ` · ${estimate}h estimated`}
          {board.project.budgetHours ? ` of ${board.project.budgetHours}h budget` : ''}
        </p>
        <span className={`ml-auto flex items-center gap-1.5 text-xs ${live ? 'text-brand-700' : 'text-gray-400'}`} role="status">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live ? 'bg-brand-500' : 'bg-gray-300'}`} />
          {live ? 'Live' : 'Reconnecting…'}
        </span>
      </div>

      {error && (
        <div className="mb-4 pr-4 lg:pr-8">
          <Alert>{error}</Alert>
        </div>
      )}
      {!board.canEdit && (
        <p className="mb-4 text-sm text-gray-500">You can view this board and comment on tasks. Ask a manager if you need to make changes.</p>
      )}

      <Board
        board={board}
        tasks={tasks}
        setTasks={setTasks}
        setColumns={(columns: ColumnDto[]) => setBoard((b) => (b ? { ...b, columns } : b))}
        onOpen={openTask}
        onError={(m) => {
          setError(m);
          setTimeout(() => setError(undefined), 6000);
        }}
        reload={load}
      />

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
