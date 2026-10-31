'use client';

import { createProjectSchema, hasRole, type CompanyDto, type ProjectSummaryDto, type TemplateDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, PageHeader, btn, input, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const STATUS_LABEL: Record<ProjectSummaryDto['status'], string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

export default function ProjectsPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const canCreate = hasRole(workspace.role, 'manager');
  const [projects, setProjects] = useState<ProjectSummaryDto[]>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<ProjectSummaryDto[]>('/projects')
      .then(setProjects)
      .catch(() => setError('Could not load projects.'));
  }, [api]);

  useEffect(load, [load]);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every project belongs to a client, so hours roll up to client profitability."
        action={
          canCreate && !creating ? (
            <button onClick={() => setCreating(true)} className={btn.primary}>
              New project
            </button>
          ) : undefined
        }
      />
      {error && <Alert>{error}</Alert>}
      {creating && <NewProject onClose={() => setCreating(false)} />}

      {!projects ? (
        <Loading />
      ) : projects.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-500">
            No projects yet.{canCreate ? ' Create one to get a board with To do, In progress, Review and Done.' : ''}
          </p>
        </Card>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const total = p.openTasks + p.doneTasks;
            const pct = total ? Math.round((p.doneTasks / total) * 100) : 0;
            return (
              <Link
                key={p.id}
                href={`/app/projects/${p.id}`}
                className="rounded-3xl bg-white p-5 shadow-sm lift"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{p.name}</p>
                  {p.status !== 'active' && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{STATUS_LABEL[p.status]}</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-gray-500">{p.client?.name ?? 'No client'}</p>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                  <div className="h-full origin-left animate-grow-x rounded-full bg-lime" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {p.doneTasks} of {total} tasks done
                  {p.actualHours > 0 && ` · ${Math.round(p.actualHours * 10) / 10}h logged`}
                  {p.budgetHours ? (
                    <span className={p.actualHours > p.budgetHours ? 'font-medium text-red-600' : ''}> of {p.budgetHours}h budget</span>
                  ) : null}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const api = useWorkspaceApi();
  const router = useRouter();
  const { workspace } = useWorkspace();
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [templateId, setTemplateId] = useState('');
  const template = templates.find((t) => t.id === templateId);
  const [clients, setClients] = useState<CompanyDto[]>([]);
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<CompanyDto[]>('/companies')
      .then((c) => {
        setClients(c);
        if (c.length === 0) setClientMode('new');
      })
      .catch(() => {});
    api<TemplateDto[]>('/project-templates')
      .then(setTemplates)
      .catch(() => {});
  }, [api]);

  async function deleteTemplate(t: TemplateDto) {
    if (!window.confirm(`Delete the template "${t.name}"? Projects made from it stay as they are.`)) return;
    try {
      await api(`/project-templates/${t.id}`, { method: 'DELETE' });
      setTemplates((cur) => cur.filter((x) => x.id !== t.id));
      setTemplateId('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the template.');
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(undefined);
    setPending(true);
    try {
      let clientId = (form.get('clientId') as string) || null;
      const newClient = String(form.get('newClient') ?? '').trim();
      if (clientMode === 'new' && newClient) {
        clientId = (await api<CompanyDto>('/companies', { method: 'POST', body: { name: newClient } })).id;
      }
      const budget = String(form.get('budgetHours') ?? '').trim();
      const parsed = createProjectSchema.safeParse({
        name: form.get('name'),
        clientId,
        budgetHours: budget ? Number(budget) : null,
        templateId: templateId || undefined,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message);
        setPending(false);
        return;
      }
      const project = await api<ProjectSummaryDto>('/projects', { method: 'POST', body: parsed.data });
      router.push(`/app/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the project.');
      setPending(false);
    }
  }

  return (
    <div className="mb-6">
      <Card title="New project">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-gray-700">Project name</span>
            <input name="name" autoFocus placeholder="e.g. Website rebuild" className={`mt-1 ${input}`} />
          </label>
          <div>
            <span className="text-sm font-medium text-gray-700">Client</span>
            {clientMode === 'existing' ? (
              <div className="mt-1 flex gap-2">
                <select name="clientId" defaultValue="" className={input}>
                  <option value="">No client (internal)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setClientMode('new')} className={`${btn.ghost} shrink-0`}>
                  + New
                </button>
              </div>
            ) : (
              <div className="mt-1 flex gap-2">
                <input name="newClient" placeholder="Client name" aria-label="New client name" className={input} />
                {clients.length > 0 && (
                  <button type="button" onClick={() => setClientMode('existing')} className={`${btn.ghost} shrink-0`}>
                    Pick existing
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Start from</span>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`mt-1 ${input}`}>
                <option value="">Blank board (To do, In progress, Review, Done)</option>
                <optgroup label="Templates">
                  {templates.filter((t) => t.builtin).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                {templates.some((t) => !t.builtin) && (
                  <optgroup label="Saved by your team">
                    {templates.filter((t) => !t.builtin).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {template && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                {template.description && <span>{template.description.replace(/\.?$/, '.')}</span>}
                <span>
                  Columns: {template.columns.join(' → ')} · {template.taskCount} starter task{template.taskCount === 1 ? '' : 's'}
                </span>
                {!template.builtin && hasRole(workspace.role, 'manager') && (
                  <button type="button" className="text-red-600 hover:underline" onClick={() => deleteTemplate(template)}>
                    Delete template
                  </button>
                )}
              </p>
            )}
          </div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Budget (hours, optional)</span>
            <input name="budgetHours" type="number" min="0" step="0.5" className={`mt-1 ${input}`} />
          </label>
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error}</Alert>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending} className={btn.primary}>
              {pending ? 'Creating…' : 'Create project'}
            </button>
            <button type="button" onClick={onClose} className={btn.ghost}>
              Cancel
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
