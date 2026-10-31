'use client';

import { createTeamSchema, hasRole, type TeamDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, btn, input, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

export default function TeamsPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [teams, setTeams] = useState<TeamDto[]>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const canCreate = hasRole(workspace.role, 'manager');

  const load = useCallback(() => {
    api<TeamDto[]>('/teams')
      .then(setTeams)
      .catch(() => setError('Could not load teams.'));
  }, [api]);

  useEffect(load, [load]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const parsed = createTeamSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      await api('/teams', { method: 'POST', body: parsed.data });
      form.reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the team.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader title="Teams" description="Group people by department so reports and permissions follow them." />
      <Card>
        {teams === undefined ? (
          <Loading />
        ) : teams.length === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-4 text-sm text-gray-500">
            No teams yet.{canCreate ? ' Create your first one below, for example “Design” or “Sales”.' : ''}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {teams.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
        {canCreate && (
          <form onSubmit={onSubmit} className="mt-4 flex gap-2">
            <input name="name" aria-label="New team name" placeholder="New team name" className={`min-w-0 flex-1 ${input}`} />
            <button type="submit" disabled={pending} className={btn.primary}>
              Add team
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        )}
      </Card>
    </>
  );
}
