'use client';

import { CURRENCIES, dealSchema, hasRole, type CompanyDto, type DealDto, type MoneyDto, type PipelineDto, type TemplateDto } from '@workhub/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/inbox/dialogs';
import { Alert, btn, input } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';
import { ActivityPanel } from './activities';
import { errorText, Labelled, OwnerSelect, useTeam } from './shared';

export function money(value: number, currency: string) {
  return `${currency} ${value.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

export function moneyList(list: MoneyDto[]) {
  return list.length ? list.map((m) => money(m.value, m.currency)).join(' + ') : '—';
}

/** Marks a deal won; managers can start its project from a template at the same time. */
export function WinDialog({ deal, onClose, onDone }: { deal: DealDto; onClose: () => void; onDone: (d: DealDto) => void }) {
  const api = useWorkspaceApi();
  const { workspace } = useWorkspace();
  const canProject = hasRole(workspace.role, 'manager') && !deal.projectId;
  const [startProject, setStartProject] = useState(canProject);
  const [name, setName] = useState(deal.title);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (canProject) api<TemplateDto[]>('/project-templates').then(setTemplates).catch(() => {});
  }, [api, canProject]);

  async function win() {
    setSaving(true);
    try {
      onDone(await api<DealDto>(`/crm/deals/${deal.id}/win`, { method: 'POST', body: startProject ? { project: { name, templateId: templateId || undefined } } : {} }));
    } catch (err) {
      setError(errorText(err, 'Could not mark it won.'));
      setSaving(false);
    }
  }

  return (
    <Modal label="Mark won" onClose={onClose}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div>
          <h2 className="text-base font-semibold">Won: {deal.title}</h2>
          {deal.value !== null && <p className="text-sm text-gray-500">{money(deal.value, deal.currency)}</p>}
        </div>
        {error && <Alert>{error}</Alert>}
        {canProject ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={startProject} onChange={(e) => setStartProject(e.target.checked)} className="h-4 w-4 accent-brand-600" />
              Start the project now{deal.company ? ` for ${deal.company.name}` : ''}
            </label>
            {startProject && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Labelled label="Project name">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={input} />
                </Labelled>
                <Labelled label="Template">
                  <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={input}>
                    <option value="">Blank board</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Labelled>
              </div>
            )}
          </>
        ) : (
          !deal.projectId && <p className="text-sm text-gray-500">A manager can start its project from the Client page.</p>
        )}
        <div className="flex gap-2">
          <button type="button" className={btn.primary} disabled={saving || (startProject && !name.trim())} onClick={() => void win()}>
            {saving ? 'Saving…' : startProject ? 'Mark won and create project' : 'Mark won'}
          </button>
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function DealDialog({
  deal,
  companyId,
  pipeline,
  onClose,
  onSaved,
}: {
  deal: DealDto | null;
  /** For a new deal: the company it's for. */
  companyId?: string;
  pipeline: PipelineDto;
  onClose: () => void;
  /** After any change; `closed` when the dialog should go away. */
  onSaved: (closed: boolean) => void;
}) {
  const api = useWorkspaceApi();
  const { workspace, me } = useWorkspace();
  const team = useTeam();
  const [current, setCurrent] = useState(deal);
  const [f, setF] = useState({
    title: deal?.title ?? '',
    value: deal?.value?.toString() ?? '',
    currency: deal?.currency ?? '',
    companyId: deal?.company?.id ?? companyId ?? '',
    ownerId: deal?.owner?.id ?? me.user.id,
    expectedClose: deal?.expectedClose ?? '',
    notes: deal?.notes ?? '',
    stageId: deal?.stageId ?? pipeline.stages.find((s) => s.kind === 'open')?.id ?? '',
  });
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [winning, setWinning] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api<CompanyDto[]>('/companies')
      .then(setCompanies)
      .catch(() => {});
  }, [api]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      title: f.title,
      value: f.value === '' ? null : Number(f.value),
      currency: f.currency || undefined,
      companyId: f.companyId || null,
      ownerId: f.ownerId || null,
      expectedClose: f.expectedClose || null,
      notes: f.notes || null,
      ...(current ? {} : { pipelineId: pipeline.id, stageId: f.stageId }),
    };
    const parsed = dealSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSaving(true);
    try {
      await api(current ? `/crm/deals/${current.id}` : '/crm/deals', { method: current ? 'PATCH' : 'POST', body });
      onSaved(true);
    } catch (err) {
      setError(errorText(err, 'Could not save the deal.'));
      setSaving(false);
    }
  }

  async function moveTo(stageId: string) {
    if (!current) return setF({ ...f, stageId });
    const stage = pipeline.stages.find((s) => s.id === stageId);
    if (stage?.kind === 'won') return setWinning(true);
    let lostReason: string | undefined;
    if (stage?.kind === 'lost') {
      const r = prompt('Why was it lost? (optional)');
      if (r === null) return;
      lostReason = r || undefined;
    }
    try {
      setCurrent(await api<DealDto>(`/crm/deals/${current.id}/move`, { method: 'POST', body: { stageId, lostReason } }));
      setF((x) => ({ ...x, stageId }));
      onSaved(false);
    } catch (err) {
      setError(errorText(err, 'Could not move it.'));
    }
  }

  async function remove() {
    if (!current || !confirm(`Delete the deal “${current.title}”?`)) return;
    try {
      await api(`/crm/deals/${current.id}`, { method: 'DELETE' });
      onSaved(true);
    } catch (err) {
      setError(errorText(err, 'Could not delete it.'));
    }
  }

  if (winning && current) {
    return (
      <WinDialog
        deal={current}
        onClose={() => setWinning(false)}
        onDone={(d) => {
          setCurrent(d);
          setF((x) => ({ ...x, stageId: d.stageId }));
          setWinning(false);
          onSaved(false);
        }}
      />
    );
  }

  const mayDelete = current && (hasRole(workspace.role, 'manager') || current.owner?.id === me.user.id);

  return (
    <Modal label={current ? current.title : 'New deal'} onClose={onClose} wide>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <h2 className="text-base font-semibold">{current ? 'Deal' : 'New deal'}</h2>
            {current?.status === 'won' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Won</span>}
            {current?.status === 'lost' && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Lost{current.lostReason ? `: ${current.lostReason}` : ''}</span>}
            {current?.projectId && (
              <Link href={`/app/projects/${current.projectId}`} className="text-sm text-brand-700 underline">
                Open its project
              </Link>
            )}
            {current?.status === 'open' && (
              <span className="ml-auto flex gap-2">
                <button type="button" className={`${btn.primary} !py-1.5`} onClick={() => setWinning(true)}>
                  Won
                </button>
                <button type="button" className={`${btn.secondary} !py-1.5`} onClick={() => void moveTo(pipeline.stages.find((s) => s.kind === 'lost')!.id)}>
                  Lost
                </button>
              </span>
            )}
          </div>
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error}</Alert>
            </div>
          )}
          <Labelled label="Deal" wide>
            <input value={f.title} onChange={set('title')} required maxLength={150} autoFocus={!current} placeholder="e.g. Website redesign for Acme" className={input} />
          </Labelled>
          <Labelled label="Stage">
            <select value={f.stageId} onChange={(e) => void moveTo(e.target.value)} className={input}>
              {pipeline.stages
                .filter((s) => current || s.kind === 'open')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.kind === 'open' ? ` (${s.probability}%)` : ''}
                  </option>
                ))}
            </select>
          </Labelled>
          <Labelled label="Value">
            <span className="flex gap-2">
              <select value={f.currency} onChange={set('currency')} aria-label="Currency" className={`${input} !w-24`}>
                {!current && <option value="">Default</option>}
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input type="number" min={0} step="any" value={f.value} onChange={set('value')} className={input} />
            </span>
          </Labelled>
          <Labelled label="Company">
            <select value={f.companyId} onChange={set('companyId')} className={input}>
              <option value="">No company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Expected to close">
            <input type="date" value={f.expectedClose} onChange={set('expectedClose')} className={input} />
          </Labelled>
          <Labelled label="Owner">
            <OwnerSelect team={team} value={f.ownerId} onChange={(ownerId) => setF({ ...f, ownerId })} />
          </Labelled>
          <Labelled label="Notes" wide>
            <textarea value={f.notes} onChange={set('notes')} rows={2} maxLength={5000} className={input} />
          </Labelled>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className={btn.primary} disabled={saving}>
              {saving ? 'Saving…' : current ? 'Save' : 'Add deal'}
            </button>
            <button type="button" className={btn.ghost} onClick={onClose}>
              {current ? 'Close' : 'Cancel'}
            </button>
            {mayDelete && (
              <button type="button" className={`${btn.danger} ml-auto`} onClick={() => void remove()}>
                Delete
              </button>
            )}
          </div>
        </form>
        {current && (
          <section className="mt-6 border-t border-gray-100 pt-4">
            <h3 className="mb-3 text-sm font-semibold">Activity</h3>
            <ActivityPanel target={{ dealId: current.id }} />
          </section>
        )}
      </div>
    </Modal>
  );
}
