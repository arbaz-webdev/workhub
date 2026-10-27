'use client';

import { hasRole, pipelineSchema, type PipelineDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { CrmTabs, errorText } from '@/components/crm/shared';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

type Draft = { id?: string; name: string; probability: number }[];

export default function PipelinesPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [list, setList] = useState<PipelineDto[]>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<PipelineDto[]>('/crm/pipelines')
      .then(setList)
      .catch(() => setError('Could not load pipelines.'));
  }, [api]);
  useEffect(load, [load]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title="CRM" />
        <CrmTabs />
        <Alert>Only managers can change pipelines.</Alert>
      </>
    );
  }

  async function save(p: PipelineDto | null, name: string, stages: Draft): Promise<boolean> {
    setError(undefined);
    setNotice(undefined);
    const parsed = pipelineSchema.safeParse({ name, stages });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return false;
    }
    try {
      await api(p ? `/crm/pipelines/${p.id}` : '/crm/pipelines', { method: p ? 'PATCH' : 'POST', body: parsed.data });
      setNotice('Saved.');
      load();
      return true;
    } catch (err) {
      setError(errorText(err, 'Could not save the pipeline.'));
      return false;
    }
  }

  async function remove(p: PipelineDto) {
    if (!confirm(`Remove the ${p.name} pipeline? Its won and lost deals stay in reports.`)) return;
    try {
      await api(`/crm/pipelines/${p.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorText(err, 'Could not remove it.'));
    }
  }

  return (
    <>
      <PageHeader title="CRM" description="The stages your deals move through, and how likely each one is to close. Every pipeline ends in Won and Lost." />
      <CrmTabs />
      <div className="space-y-6" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {list?.map((p) => (
          <PipelineEditor key={p.id + p.stages.map((s) => s.id).join()} pipeline={p} onSave={(n, s) => save(p, n, s)} onRemove={p.isDefault ? undefined : () => void remove(p)} />
        ))}
        <PipelineEditor pipeline={null} onSave={(n, s) => save(null, n, s)} />
      </div>
    </>
  );
}

function PipelineEditor({ pipeline, onSave, onRemove }: { pipeline: PipelineDto | null; onSave: (name: string, stages: Draft) => Promise<boolean>; onRemove?: () => void }) {
  const [name, setName] = useState(pipeline?.name ?? '');
  const [stages, setStages] = useState<Draft>(pipeline?.stages.filter((s) => s.kind === 'open').map(({ id, name: n, probability }) => ({ id, name: n, probability })) ?? [{ name: 'New', probability: 10 }]);
  const update = (i: number, patch: Partial<Draft[number]>) => setStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const swap = (i: number, j: number) => {
    const next = [...stages];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setStages(next);
  };

  return (
    <Card title={pipeline ? `${pipeline.name}${pipeline.isDefault ? ' (default)' : ''}` : 'Add a pipeline'}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await onSave(name, stages)) && !pipeline) {
            setName('');
            setStages([{ name: 'New', probability: 10 }]);
          }
        }}
      >
        <label className="block text-sm">
          <span className="text-gray-700">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Retainers" className={`mt-1 ${input} sm:!w-72`} />
        </label>
        <ol className="space-y-2">
          {stages.map((s, i) => (
            <li key={s.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-right text-xs text-gray-400">{i + 1}</span>
              <input value={s.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={`Stage ${i + 1} name`} maxLength={60} className={`${input} !w-48`} />
              <label className="flex items-center gap-1 text-sm text-gray-600">
                <input type="number" min={0} max={100} value={s.probability} onChange={(e) => update(i, { probability: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} aria-label={`Stage ${i + 1} chance of winning`} className={`${input} !w-20`} />%
              </label>
              <button type="button" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => swap(i, i - 1)} className={`${btn.ghost} !px-2 disabled:opacity-30`}>
                ↑
              </button>
              <button type="button" aria-label={`Move ${s.name} down`} disabled={i === stages.length - 1} onClick={() => swap(i, i + 1)} className={`${btn.ghost} !px-2 disabled:opacity-30`}>
                ↓
              </button>
              <button type="button" aria-label={`Remove ${s.name}`} disabled={stages.length === 1} onClick={() => setStages(stages.filter((_, j) => j !== i))} className={`${btn.danger} !px-2 disabled:opacity-30`}>
                ×
              </button>
            </li>
          ))}
          <li className="pl-7 text-sm text-gray-500">Then: Won (100%) and Lost (0%)</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.secondary} onClick={() => setStages([...stages, { name: '', probability: 50 }])} disabled={stages.length >= 15}>
            Add stage
          </button>
          <button type="submit" className={btn.primary}>
            {pipeline ? 'Save' : 'Add pipeline'}
          </button>
          {onRemove && (
            <button type="button" className={`${btn.danger} ml-auto`} onClick={onRemove}>
              Remove pipeline
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
