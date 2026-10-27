'use client';

import { hasRole, type CrmActivityDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { ActivityRow } from '@/components/crm/activities';
import { CrmTabs } from '@/components/crm/shared';
import { Alert, PageHeader } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const startOfTomorrow = () => {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
};

export default function FollowUpsPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const isManager = hasRole(workspace.role, 'manager');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [items, setItems] = useState<CrmActivityDto[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<CrmActivityDto[]>(`/crm/follow-ups?scope=${scope}`)
      .then(setItems)
      .catch(() => setError('Could not load follow-ups.'));
  }, [api, scope]);
  useEffect(load, [load]);

  async function toggle(a: CrmActivityDto, done: boolean) {
    setItems((list) => list?.filter((x) => x.id !== a.id || !done));
    await api(`/crm/activities/${a.id}`, { method: 'PATCH', body: { done } }).catch(() => setError('Could not save that.'));
  }

  const tomorrow = startOfTomorrow();
  const groups: [string, CrmActivityDto[]][] = [
    ['Overdue', items?.filter((a) => a.overdue) ?? []],
    ['Today', items?.filter((a) => !a.overdue && a.dueAt! < tomorrow) ?? []],
    ['Coming up', items?.filter((a) => a.dueAt! >= tomorrow) ?? []],
  ];

  return (
    <>
      <PageHeader title="CRM" description="Calls to make and messages to send. You get a notification when each one is due." />
      <CrmTabs />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {isManager && (
        <div className="mb-4 flex rounded-lg border border-gray-300 p-0.5 text-sm" role="tablist" aria-label="Whose">
          {(['mine', 'all'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={`rounded-md px-3 py-1 font-medium ${scope === s ? 'bg-brand-50 text-brand-700' : 'text-gray-600'}`}>
              {s === 'mine' ? 'Mine' : 'Everyone’s'}
            </button>
          ))}
        </div>
      )}
      {!items ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <p className="font-medium text-gray-800">You’re all caught up</p>
          <p className="mt-1 text-sm text-gray-500">Schedule a follow-up from any deal or client page.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups
            .filter(([, list]) => list.length > 0)
            .map(([title, list]) => (
              <section key={title} className="rounded-2xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
                <h2 className={`text-sm font-semibold ${title === 'Overdue' ? 'text-red-600' : 'text-gray-800'}`}>
                  {title} ({list.length})
                </h2>
                <ul className="divide-y divide-gray-100">
                  {list.map((a) => (
                    <ActivityRow key={a.id} a={a} showTarget onToggle={(d) => void toggle(a, d)} />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </>
  );
}
