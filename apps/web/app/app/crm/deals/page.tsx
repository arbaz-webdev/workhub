'use client';

import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import type { DealDto, PipelineDto, StageDto } from '@workhub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { DealDialog, money, moneyList, WinDialog } from '@/components/crm/deals';
import { CrmTabs } from '@/components/crm/shared';
import { Alert, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';
import { sumMoney } from '@/components/crm/money';

export default function DealsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
      <Deals />
    </Suspense>
  );
}

function Deals() {
  const api = useWorkspaceApi();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('open');
  const [pipelines, setPipelines] = useState<PipelineDto[]>();
  const [pipelineId, setPipelineId] = useState<string>();
  const [deals, setDeals] = useState<DealDto[]>();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [status, setStatus] = useState<'open' | 'won' | 'lost'>('open');
  const [editing, setEditing] = useState<DealDto | 'new' | null>(null);
  const [winning, setWinning] = useState<DealDto | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<PipelineDto[]>('/crm/pipelines')
      .then((list) => {
        setPipelines(list);
        setPipelineId((id) => id ?? list[0]?.id);
      })
      .catch(() => setError('Could not load pipelines.'));
  }, [api]);

  const pipeline = pipelines?.find((p) => p.id === pipelineId);
  const load = useCallback(() => {
    if (!pipelineId) return;
    // The board shows open deals; the list can show won or lost ones too.
    api<DealDto[]>(`/crm/deals?pipelineId=${pipelineId}&status=${view === 'board' ? 'open' : status}`)
      .then(setDeals)
      .catch(() => setError('Could not load deals.'));
  }, [api, pipelineId, view, status]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!openId) return;
    api<DealDto>(`/crm/deals/${openId}`)
      .then((d) => {
        setPipelineId(d.pipelineId);
        setEditing(d);
      })
      .catch(() => setError('That deal isn’t available any more.'));
  }, [api, openId]);

  const close = () => {
    setEditing(null);
    if (openId) router.replace('/app/crm/deals', { scroll: false });
  };

  async function move(deal: DealDto, stage: StageDto) {
    if (deal.stageId === stage.id) return;
    if (stage.kind === 'won') return setWinning(deal);
    let lostReason: string | undefined;
    if (stage.kind === 'lost') {
      const r = prompt(`Why was “${deal.title}” lost? (optional)`);
      if (r === null) return;
      lostReason = r || undefined;
    }
    // Show it in its new place straight away.
    setDeals((list) => (stage.kind === 'open' ? list?.map((d) => (d.id === deal.id ? { ...d, stageId: stage.id, stageName: stage.name, probability: stage.probability } : d)) : list?.filter((d) => d.id !== deal.id)));
    try {
      await api(`/crm/deals/${deal.id}/move`, { method: 'POST', body: { stageId: stage.id, lostReason } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not move the deal.');
    }
    load();
  }

  const open = pipeline?.stages.filter((s) => s.kind === 'open') ?? [];
  const total = deals ? sumMoney(deals) : [];
  const weighted = deals ? sumMoney(deals.map((d) => ({ ...d, value: d.value === null ? null : (d.value * d.probability) / 100 }))) : [];

  return (
    <>
      <PageHeader
        title="CRM"
        description="Your deals from first call to signed, in any currency."
        action={
          <button type="button" className={btn.primary} onClick={() => setEditing('new')} disabled={!pipeline}>
            New deal
          </button>
        }
      />
      <CrmTabs />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {pipelines && pipelines.length > 1 && (
          <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} aria-label="Pipeline" className={`${input} !w-48`}>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex rounded-lg border border-gray-300 p-0.5 text-sm" role="tablist" aria-label="View">
          {(['board', 'list'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 font-medium ${view === v ? 'bg-brand-50 text-brand-700' : 'text-gray-600'}`}>
              {v === 'board' ? 'Board' : 'List'}
            </button>
          ))}
        </div>
        {view === 'list' && (
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status" className={`${input} !w-32`}>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        )}
        {deals && (view === 'board' || status === 'open') && (
          <span className="ml-auto text-sm text-gray-600">
            {deals.length} open · {moneyList(total)}
            <span className="text-gray-400"> · forecast {moneyList(weighted)}</span>
          </span>
        )}
      </div>

      {!pipeline || !deals ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : view === 'board' ? (
        <Board stages={pipeline.stages} open={open} deals={deals} onOpen={setEditing} onMove={(d, s) => void move(d, s)} />
      ) : (
        <List deals={deals} onOpen={setEditing} />
      )}

      {editing && pipeline && (
        <DealDialog
          key={editing === 'new' ? 'new' : editing.id}
          deal={editing === 'new' ? null : editing}
          pipeline={pipeline}
          onClose={() => {
            close();
            load();
          }}
          onSaved={(closed) => {
            if (closed) close();
            load();
          }}
        />
      )}
      {winning && (
        <WinDialog
          deal={winning}
          onClose={() => setWinning(null)}
          onDone={() => {
            setWinning(null);
            load();
          }}
        />
      )}
    </>
  );
}

function Board({ stages, open, deals, onOpen, onMove }: { stages: StageDto[]; open: StageDto[]; deals: DealDto[]; onOpen: (d: DealDto) => void; onMove: (d: DealDto, s: StageDto) => void }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Press and hold on touch screens, so swiping still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const byStage = useMemo(() => new Map(open.map((s) => [s.id, deals.filter((d) => d.stageId === s.id)])), [open, deals]);
  const closing = stages.filter((s) => s.kind !== 'open');

  function onDragEnd(e: DragEndEvent) {
    const deal = deals.find((d) => d.id === e.active.id);
    const stage = stages.find((s) => s.id === e.over?.id);
    if (deal && stage) onMove(deal, stage);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: 'Press Space to pick up a deal, the arrow keys to move it, and Space again to drop it on a stage.' } }}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {open.map((s) => (
          <Column key={s.id} stage={s} deals={byStage.get(s.id) ?? []} onOpen={onOpen} />
        ))}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {closing.map((s) => (
          <CloseZone key={s.id} stage={s} />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ stage, deals, onOpen }: { stage: StageDto; deals: DealDto[]; onOpen: (d: DealDto) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section ref={setNodeRef} aria-label={stage.name} className={`flex w-64 shrink-0 flex-col rounded-xl p-2 ${isOver ? 'bg-brand-50' : 'bg-gray-100'}`}>
      <header className="mb-2 px-1">
        <p className="flex items-center justify-between text-sm font-semibold text-gray-800">
          {stage.name}
          <span className="text-xs font-normal text-gray-500">{stage.probability}%</span>
        </p>
        <p className="text-xs text-gray-500">
          {deals.length} · {moneyList(sumMoney(deals))}
        </p>
      </header>
      <ul className="min-h-16 space-y-2">
        {deals.map((d) => (
          <DealCard key={d.id} deal={d} onOpen={() => onOpen(d)} />
        ))}
      </ul>
    </section>
  );
}

function DealCard({ deal, onOpen }: { deal: DealDto; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const late = deal.expectedClose && deal.expectedClose < new Date().toISOString().slice(0, 10);
  const followOverdue = deal.nextActivity && deal.nextActivity.dueAt < new Date().toISOString();
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'relative z-10 opacity-80' : ''}>
      <div
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        aria-label={`${deal.title}${deal.value !== null ? `, ${money(deal.value, deal.currency)}` : ''}. Enter to open, Space to move.`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen();
          else listeners?.onKeyDown?.(e);
        }}
        className="cursor-grab rounded-lg border border-gray-200 bg-white p-2.5 text-sm shadow-sm hover:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 active:cursor-grabbing"
      >
        <p className="font-medium text-gray-900">{deal.title}</p>
        {deal.company && <p className="truncate text-xs text-gray-500">{deal.company.name}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {deal.value !== null && <span className="font-medium text-gray-800">{money(deal.value, deal.currency)}</span>}
          {deal.expectedClose && <span className={late ? 'text-red-600' : 'text-gray-500'}>Close {new Date(`${deal.expectedClose}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
          {deal.owner && <span className="ml-auto text-gray-500">{deal.owner.name.split(' ')[0]}</span>}
        </p>
        {deal.nextActivity && (
          <p className={`mt-1 truncate text-xs ${followOverdue ? 'font-medium text-red-600' : 'text-gray-500'}`}>
            {followOverdue ? 'Overdue: ' : 'Next: '}
            {deal.nextActivity.subject}
          </p>
        )}
      </div>
    </li>
  );
}

function CloseZone({ stage }: { stage: StageDto }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const won = stage.kind === 'won';
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 border-dashed px-4 py-3 text-center text-sm font-medium ${
        won ? (isOver ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-emerald-200 text-emerald-700') : isOver ? 'border-gray-500 bg-gray-100 text-gray-800' : 'border-gray-200 text-gray-500'
      }`}
    >
      Drop here: {stage.name}
    </div>
  );
}

function List({ deals, onOpen }: { deals: DealDto[]; onOpen: (d: DealDto) => void }) {
  if (deals.length === 0) return <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">No deals here.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
          <tr>
            <th className="px-3 py-2">Deal</th>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2 text-right">Value</th>
            <th className="px-3 py-2">Expected close</th>
            <th className="px-3 py-2">Owner</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
              <td className="px-3 py-2">
                <button type="button" className="text-left font-medium text-gray-900 hover:underline" onClick={() => onOpen(d)}>
                  {d.title}
                </button>
                {d.company && <span className="block text-xs text-gray-500">{d.company.name}</span>}
              </td>
              <td className="px-3 py-2 text-gray-700">
                {d.stageName}
                {d.status === 'lost' && d.lostReason && <span className="block text-xs text-gray-500">{d.lostReason}</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{d.value !== null ? money(d.value, d.currency) : '—'}</td>
              <td className="px-3 py-2 text-gray-700">{d.expectedClose ?? '—'}</td>
              <td className="px-3 py-2 text-gray-700">{d.owner?.name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
