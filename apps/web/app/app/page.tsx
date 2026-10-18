'use client';

import { createTeamSchema, createWorkspaceSchema, hasRole, type MeResponse, type TeamDto, type WorkspaceDto } from '@workhub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

const WORKSPACE_KEY = 'wh_workspace';

function readStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export default function AppHome() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse>();
  const [workspace, setWorkspace] = useState<WorkspaceDto>();

  useEffect(() => {
    api<MeResponse>('/auth/me')
      .then((data) => {
        setMe(data);
        const stored = readStoredWorkspace();
        setWorkspace(data.workspaces.find((w) => w.id === stored) ?? data.workspaces[0]);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/sign-in');
      });
  }, [router]);

  function switchTo(next: WorkspaceDto) {
    try {
      localStorage.setItem(WORKSPACE_KEY, next.id);
    } catch {
      // Storage can be unavailable (private mode); switching still works for this visit.
    }
    setWorkspace(next);
  }

  function switchWorkspace(id: string) {
    const next = me?.workspaces.find((w) => w.id === id);
    if (next) switchTo(next);
  }

  async function signOut() {
    await api('/auth/sign-out', { method: 'POST' }).catch(() => {});
    router.replace('/sign-in');
  }

  if (!me) {
    return <p className="p-8 text-sm text-gray-500">Loading your workspace…</p>;
  }

  if (!workspace) {
    return (
      <FirstWorkspace
        name={me.user.name}
        onCreated={(w) => {
          setMe({ ...me, workspaces: [w] });
          switchTo(w);
        }}
      />
    );
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">W</span>
          {me.workspaces.length > 1 ? (
            <select
              aria-label="Switch workspace"
              value={workspace.id}
              onChange={(e) => switchWorkspace(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium"
            >
              {me.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm font-semibold">{workspace.name}</span>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-gray-600 sm:inline">
              {me.user.name} · <span className="capitalize">{workspace.role}</span>
            </span>
            <button onClick={signOut} className="rounded-lg px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {!me.user.emailVerified && <VerifyBanner email={me.user.email} />}

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Welcome, {me.user.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-gray-500">
          This is the start of {workspace.name}. Attendance, boards, CRM and chat arrive in the next sprints.
        </p>
        <Teams key={workspace.id} workspace={workspace} />
      </main>
    </div>
  );
}

function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function resend() {
    setState('sending');
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm text-amber-900">
        <span>
          Please confirm your email. We sent a link to <strong>{email}</strong>.
        </span>
        {state === 'sent' ? (
          <span className="font-medium">New link sent.</span>
        ) : (
          <button
            onClick={resend}
            disabled={state === 'sending'}
            className="font-semibold underline underline-offset-2 disabled:opacity-60"
          >
            {state === 'error' ? 'Could not send. Try again' : 'Resend email'}
          </button>
        )}
      </div>
    </div>
  );
}

function FirstWorkspace({ name, onCreated }: { name: string; onCreated: (w: WorkspaceDto) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = createWorkspaceSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      onCreated(await api<WorkspaceDto>('/workspaces', { method: 'POST', body: parsed.data }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the workspace.');
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Welcome, {name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-gray-500">Name your workspace. You can invite your team next.</p>
        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Company name</span>
            <input
              name="name"
              autoComplete="organization"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? 'Please wait…' : 'Create workspace'}
          </button>
        </form>
      </div>
    </main>
  );
}

function Teams({ workspace }: { workspace: WorkspaceDto }) {
  const [teams, setTeams] = useState<TeamDto[]>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const canCreate = hasRole(workspace.role, 'manager');

  const load = useCallback(() => {
    api<TeamDto[]>('/teams', { workspaceId: workspace.id })
      .then(setTeams)
      .catch(() => setError('Could not load teams.'));
  }, [workspace.id]);

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
      await api('/teams', { method: 'POST', body: parsed.data, workspaceId: workspace.id });
      form.reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the team.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">Teams</h2>
      <p className="mt-1 text-sm text-gray-500">Group people by department so reports and permissions follow them.</p>

      {teams === undefined ? (
        <p className="mt-4 text-sm text-gray-500">Loading…</p>
      ) : teams.length === 0 ? (
        <p className="mt-4 rounded-lg bg-gray-50 px-3 py-4 text-sm text-gray-500">
          No teams yet.{canCreate ? ' Create your first one below, for example “Design” or “Sales”.' : ''}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
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
          <input
            name="name"
            aria-label="New team name"
            placeholder="New team name"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Add team
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
