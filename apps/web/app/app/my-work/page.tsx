'use client';

import type { MyTaskDto, MyWorkDto } from '@workhub/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { prettyDate } from '@/components/attendance/labels';
import { hoursText, PRIORITY_STYLE } from '@/components/board/style';
import { Alert, PageHeader } from '@/components/ui';
import { useLocale, useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages/en';
import { useWorkspaceApi } from '@/lib/workspace';

type Group = 'overdue' | 'today' | 'week' | 'later' | 'none';

const GROUPS: { key: Group; title: MessageKey }[] = [
  { key: 'overdue', title: 'myWork.group.overdue' },
  { key: 'today', title: 'myWork.group.today' },
  { key: 'week', title: 'myWork.group.week' },
  { key: 'later', title: 'myWork.group.later' },
  { key: 'none', title: 'myWork.group.none' },
];

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Buckets by the workspace's "today" (from the API), so it matches the team's calendar, not the browser's. */
function groupOf(task: MyTaskDto, today: string, weekEnd: string): Group {
  if (!task.dueDate) return 'none';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  if (task.dueDate <= weekEnd) return 'week';
  return 'later';
}

export default function MyWorkPage() {
  const api = useWorkspaceApi();
  const t = useT();
  const [data, setData] = useState<MyWorkDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<MyWorkDto>('/me/tasks')
      .then(setData)
      .catch(() => setError(t('myWork.loadError')));
  }, [api, t]);
  const [emptyBefore, emptyAfter] = t('myWork.emptyHint').split('{link}');

  return (
    <>
      <PageHeader title={t('nav.myWork')} description={t('myWork.description')} />
      {error && <Alert>{error}</Alert>}
      {!data && !error && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {data && data.tasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center">
          <p className="font-medium">{t('myWork.empty')}</p>
          <p className="mt-1 text-sm text-gray-500">
            {emptyBefore}
            <Link href="/app/projects" className="underline">
              {t('myWork.emptyLink')}
            </Link>
            {emptyAfter}
          </p>
        </div>
      )}
      {data && data.tasks.length > 0 && <Groups data={data} />}
    </>
  );
}

function Groups({ data }: { data: MyWorkDto }) {
  const t = useT();
  const locale = useLocale();
  const weekEnd = addDays(data.today, 7);
  const buckets = new Map<Group, MyTaskDto[]>();
  for (const task of data.tasks) {
    const g = groupOf(task, data.today, weekEnd);
    buckets.set(g, [...(buckets.get(g) ?? []), task]);
  }
  return (
    <div className="space-y-6">
      {GROUPS.filter((g) => buckets.has(g.key)).map((g) => (
        <section key={g.key} aria-labelledby={`group-${g.key}`}>
          <h2 id={`group-${g.key}`} className={`mb-2 text-sm font-semibold ${g.key === 'overdue' ? 'text-red-600' : 'text-gray-700'}`}>
            {t(g.title)} <span className="font-normal text-gray-500">{buckets.get(g.key)!.length}</span>
          </h2>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {buckets.get(g.key)!.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/app/projects/${task.projectId}?task=${task.parentTaskId ?? task.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 font-medium text-gray-900">
                    {task.title}
                    {task.parentTaskId && <span className="ms-1.5 text-xs font-normal text-gray-500">{t('myWork.subtask')}</span>}
                  </span>
                  <span className="text-xs text-gray-500">
                    {task.projectName} · {task.columnName}
                  </span>
                  {PRIORITY_STYLE[task.priority] && (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_STYLE[task.priority]}`}>{t(`priority.${task.priority}`)}</span>
                  )}
                  {task.estimateHours !== null && <span className="text-xs text-gray-500">{hoursText(task.estimateHours, locale)}</span>}
                  {task.dueDate && (
                    <span className={`w-16 text-end text-xs ${g.key === 'overdue' ? 'font-medium text-red-600' : 'text-gray-500'}`}>
                      {prettyDate(task.dueDate, { day: 'numeric', month: 'short' }, locale)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
