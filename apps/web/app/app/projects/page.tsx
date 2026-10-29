'use client';

import { createProjectSchema, hasRole, type CompanyDto, type ProjectSummaryDto, type TemplateDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { hoursText } from '@/components/board/style';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

export default function ProjectsPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const t = useT();
  const locale = useLocale();
  const canCreate = hasRole(workspace.role, 'manager');
  const [projects, setProjects] = useState<ProjectSummaryDto[]>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<ProjectSummaryDto[]>('/projects')
      .then(setProjects)
      .catch(() => setError(t('projects.loadError')));
  }, [api, t]);

  useEffect(load, [load]);

  return (
    <>
      <PageHeader
        title={t('nav.projects')}
        description={t('projects.description')}
        action={
          canCreate && !creating ? (
            <button onClick={() => setCreating(true)} className={btn.primary}>
              {t('projects.new')}
            </button>
          ) : undefined
        }
      />
      {error && <Alert>{error}</Alert>}
      {creating && <NewProject onClose={() => setCreating(false)} />}

      {!projects ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : projects.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-500">
            {t('projects.none')}
            {canCreate ? ` ${t('projects.noneHint')}` : ''}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const total = p.openTasks + p.doneTasks;
            const pct = total ? Math.round((p.doneTasks / total) * 100) : 0;
            return (
              <Link
                key={p.id}
                href={`/app/projects/${p.id}`}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-500"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{p.name}</p>
                  {p.status !== 'active' && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t(`project.status.${p.status}`)}</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-gray-500">{p.client?.name ?? t('projects.noClient')}</p>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {t('projects.tasksDone', { done: p.doneTasks, total })}
                  {p.actualHours > 0 && ` · ${t('projects.logged', { hours: hoursText(p.actualHours, locale) })}`}
                  {p.budgetHours ? (
                    <span className={p.actualHours > p.budgetHours ? 'font-medium text-red-600' : ''}> {t('projects.ofBudget', { hours: hoursText(p.budgetHours, locale) })}</span>
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
  const t = useT();
  const locale = useLocale();
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [templateId, setTemplateId] = useState('');
  const template = templates.find((x) => x.id === templateId);
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

  async function deleteTemplate(tpl: TemplateDto) {
    if (!window.confirm(t('projects.confirmDeleteTemplate', { name: tpl.name }))) return;
    try {
      await api(`/project-templates/${tpl.id}`, { method: 'DELETE' });
      setTemplates((cur) => cur.filter((x) => x.id !== tpl.id));
      setTemplateId('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('projects.deleteTemplateFailed'));
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
      setError(err instanceof ApiError ? err.message : t('projects.createFailed'));
      setPending(false);
    }
  }

  return (
    <div className="mb-6">
      <Card title={t('projects.new')}>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-gray-700">{t('projects.name')}</span>
            <input name="name" autoFocus placeholder={t('projects.namePlaceholder')} className={`mt-1 ${input}`} />
          </label>
          <div>
            <span className="text-sm font-medium text-gray-700">{t('projects.client')}</span>
            {clientMode === 'existing' ? (
              <div className="mt-1 flex gap-2">
                <select name="clientId" defaultValue="" className={input}>
                  <option value="">{t('projects.internal')}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setClientMode('new')} className={`${btn.ghost} shrink-0`}>
                  {t('projects.newClient')}
                </button>
              </div>
            ) : (
              <div className="mt-1 flex gap-2">
                <input name="newClient" placeholder={t('projects.clientName')} aria-label={t('projects.newClientName')} className={input} />
                {clients.length > 0 && (
                  <button type="button" onClick={() => setClientMode('existing')} className={`${btn.ghost} shrink-0`}>
                    {t('projects.pickExisting')}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t('projects.startFrom')}</span>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`mt-1 ${input}`}>
                <option value="">{t('projects.blank')}</option>
                <optgroup label={t('projects.templates')}>
                  {templates.filter((x) => x.builtin).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </optgroup>
                {templates.some((x) => !x.builtin) && (
                  <optgroup label={t('projects.savedByTeam')}>
                    {templates.filter((x) => !x.builtin).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
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
                  {t('projects.columns', { columns: template.columns.join(locale === 'ur' ? ' ← ' : ' → ') })} ·{' '}
                  {template.taskCount === 1 ? t('projects.starterTasks.one') : t('projects.starterTasks.many', { n: template.taskCount })}
                </span>
                {!template.builtin && hasRole(workspace.role, 'manager') && (
                  <button type="button" className="text-red-600 hover:underline" onClick={() => deleteTemplate(template)}>
                    {t('projects.deleteTemplate')}
                  </button>
                )}
              </p>
            )}
          </div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">{t('projects.budget')}</span>
            <input name="budgetHours" type="number" min="0" step="0.5" className={`mt-1 ${input}`} />
          </label>
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error}</Alert>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending} className={btn.primary}>
              {pending ? t('inbox.creating') : t('projects.create')}
            </button>
            <button type="button" onClick={onClose} className={btn.ghost}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
