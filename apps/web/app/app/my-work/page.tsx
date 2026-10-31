'use client';

import type { MyTaskDto, MyWorkDto } from '@workhub/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { hoursText, PRIORITY_LABEL, PRIORITY_STYLE } from '@/components/board/style';
import { Alert, PageHeader, Loading } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

type Group = 'overdue' | 'today' | 'week' | 'later' | 'none';

const GROUPS: { key: Group; title: string }[] = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'today', title: 'Today' },
  { key: 'week', title: 'Next 7 days' },
  { key: 'later', title: 'Later' },
  { key: 'none', title: 'No due date' },
];

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Buckets by the workspace's "today" (from the API), so it matches the team's calendar, not the browser's. */
function groupOf(t: MyTaskDto, today: string, weekEnd: string): Group {
  if (!t.dueDate) return 'none';
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate === today) return 'today';
  if (t.dueDate <= weekEnd) return 'week';
  return 'later';
}

export default function MyWorkPage() {
  const api = useWorkspaceApi();
  const [data, setData] = useState<MyWorkDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<MyWorkDto>('/me/tasks')
      .then(setData)
      .catch(() => setError('Could not load your tasks.'));
  }, [api]);

  return (
    <>
      <PageHeader title="My work" description="Open tasks assigned to you, across every project." />
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Loading />}
      {data && data.tasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center">
          <p className="font-medium">Nothing assigned to you right now.</p>
          <p className="mt-1 text-sm text-gray-500">
            Tasks you&apos;re assigned to in <Link href="/app/projects" className="underline">projects</Link> show up here.
          </p>
        </div>
      )}
      {data && data.tasks.length > 0 && <Groups data={data} />}
    </>
  );
}

function Groups({ data }: { data: MyWorkDto }) {
  const weekEnd = addDays(data.today, 7);
  const buckets = new Map<Group, MyTaskDto[]>();
  for (const t of data.tasks) {
    const g = groupOf(t, data.today, weekEnd);
    buckets.set(g, [...(buckets.get(g) ?? []), t]);
  }
  return (
    <div className="space-y-6">
      {GROUPS.filter((g) => buckets.has(g.key)).map((g) => (
        <section key={g.key} aria-labelledby={`group-${g.key}`}>
          <h2 id={`group-${g.key}`} className={`mb-2 text-sm font-semibold ${g.key === 'overdue' ? 'text-red-600' : 'text-gray-700'}`}>
            {g.title} <span className="font-normal text-gray-500">{buckets.get(g.key)!.length}</span>
          </h2>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {buckets.get(g.key)!.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/app/projects/${t.projectId}?task=${t.parentTaskId ?? t.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 font-medium text-gray-900">
                    {t.title}
                    {t.parentTaskId && <span className="ml-1.5 text-xs font-normal text-gray-500">subtask</span>}
                  </span>
                  <span className="text-xs text-gray-500">
                    {t.projectName} · {t.columnName}
                  </span>
                  {PRIORITY_STYLE[t.priority] && (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_STYLE[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                  )}
                  {t.estimateHours !== null && <span className="text-xs text-gray-500">{hoursText(t.estimateHours)}</span>}
                  {t.dueDate && (
                    <span className={`w-16 text-right text-xs ${g.key === 'overdue' ? 'font-medium text-red-600' : 'text-gray-500'}`}>
                      {new Date(`${t.dueDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
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
