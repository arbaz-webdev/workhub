'use client';

import { hasRole, type ClientOverviewDto, type ContactDto, type CustomFieldDto, type DealDto, type PipelineDto } from '@workhub/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ActivityPanel } from '@/components/crm/activities';
import { DealDialog, money, moneyList } from '@/components/crm/deals';
import { CompanyDialog, ContactDialog } from '@/components/crm/dialogs';
import { errorText, useFields } from '@/components/crm/shared';
import { Alert, btn, timeAgo } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const PROJECT_STATUS: Record<string, string> = { active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' };
const DEAL_STATUS: Record<DealDto['status'], string> = { open: 'bg-sky-100 text-sky-800', won: 'bg-emerald-100 text-emerald-800', lost: 'bg-gray-100 text-gray-600' };

function show(f: CustomFieldDto, v: unknown) {
  if (v === null || v === undefined) return null;
  if (f.type === 'checkbox') return v ? 'Yes' : 'No';
  if (f.type === 'date') return new Date(`${String(v)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return String(v);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold text-gray-900" title={value}>
        {value}
      </p>
      {hint && <p className="truncate text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** Client 360: everything about one company on one page. */
export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const api = useWorkspaceApi();
  const router = useRouter();
  const { workspace, me } = useWorkspace();
  const fields = useFields('company');
  const [data, setData] = useState<ClientOverviewDto>();
  const [pipelines, setPipelines] = useState<PipelineDto[]>([]);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<ContactDto | 'new' | null>(null);
  const [deal, setDeal] = useState<DealDto | 'new' | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<ClientOverviewDto>(`/crm/companies/${id}`)
      .then(setData)
      .catch(() => setError('This company isn’t available. It may have been deleted.'));
  }, [api, id]);
  useEffect(load, [load]);
  useEffect(() => {
    api<PipelineDto[]>('/crm/pipelines')
      .then(setPipelines)
      .catch(() => {});
  }, [api]);

  async function remove() {
    if (!data || !confirm(`Delete ${data.company.name}? Its contacts stay, without a company, and its projects lose their client.`)) return;
    try {
      await api(`/crm/companies/${id}`, { method: 'DELETE' });
      router.push('/app/crm/companies');
    } catch (err) {
      setError(errorText(err, 'Could not delete it.'));
    }
  }

  if (!data) {
    return (
      <>
        <Link href="/app/crm/companies" className="text-sm text-brand-700 hover:underline">
          ← Companies
        </Link>
        <div className="mt-4">{error ? <Alert>{error}</Alert> : <p className="text-sm text-gray-500">Loading…</p>}</div>
      </>
    );
  }
  const c = data.company;
  const details: [string, React.ReactNode][] = [
    ['Website', c.website && (
      <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
        {c.website.replace(/^https?:\/\//, '')}
      </a>
    )],
    ['Email', c.email && <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a>],
    ['Phone', c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="hover:underline">{c.phone}</a>],
    ['Industry', c.industry],
    ['Location', [c.city, c.country].filter(Boolean).join(', ') || null],
    ['Address', c.address],
    ['Owner', c.owner?.name],
    ...fields.map((f) => [f.label, show(f, c.custom[f.key])] as [string, React.ReactNode]),
  ];
  const openDeals = data.deals.filter((d) => d.status === 'open');
  const pipelineOf = (d: DealDto | null) => pipelines.find((p) => (d ? p.id === d.pipelineId : p.isDefault)) ?? pipelines[0];

  return (
    <>
      <Link href="/app/crm/companies" className="text-sm text-brand-700 hover:underline">
        ← Companies
      </Link>
      <div className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <p className="text-sm text-gray-500">{[c.industry, c.city].filter(Boolean).join(' · ') || 'Client'}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} onClick={() => setEditing(true)}>
            Edit
          </button>
          {(hasRole(workspace.role, 'manager') || c.owner?.id === me.user.id) && (
            <button type="button" className={btn.danger} onClick={() => void remove()}>
              Delete
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Won" value={moneyList(data.totals.won)} hint={plural(data.deals.filter((d) => d.status === 'won').length, 'deal')} />
        <Stat label="In the pipeline" value={moneyList(data.totals.open)} hint={`Forecast ${moneyList(data.totals.weighted)}`} />
        <Stat label="Hours this month" value={`${data.totals.hoursThisMonth} h`} hint={`${data.totals.hoursTotal} h in total`} />
        <Stat label="Projects" value={String(data.projects.length)} hint={`${data.projects.filter((p) => p.status === 'active').length} active`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Details</h2>
            <dl className="space-y-2 text-sm">
              {details
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-gray-500">{k}</dt>
                    <dd className="break-words text-gray-900">{v}</dd>
                  </div>
                ))}
            </dl>
            {c.notes && <p className="mt-4 whitespace-pre-wrap border-t border-gray-100 pt-3 text-sm text-gray-700">{c.notes}</p>}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">People ({data.contacts.length})</h2>
              <button type="button" className={btn.ghost} onClick={() => setContact('new')}>
                Add
              </button>
            </div>
            {data.contacts.length === 0 ? (
              <p className="text-sm text-gray-500">No contacts yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.contacts.map((p) => (
                  <li key={p.id} className="py-2 text-sm">
                    <button type="button" className="font-medium text-gray-900 hover:underline" onClick={() => setContact(p)}>
                      {p.name}
                    </button>
                    <span className="block truncate text-xs text-gray-500">{[p.title, p.email ?? p.phone].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.files.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold">Files</h2>
              <ul className="divide-y divide-gray-100">
                {data.files.map((f) => (
                  <li key={f.id} className="py-2 text-sm">
                    <a href={`/api${f.url}`} target={f.isImage ? '_blank' : undefined} rel="noopener" download={f.isImage ? undefined : f.fileName} className="block truncate font-medium text-gray-900 hover:underline">
                      {f.fileName}
                    </a>
                    <span className="text-xs text-gray-500">
                      {f.projectName} · {timeAgo(f.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Deals ({openDeals.length} open of {data.deals.length})
              </h2>
              <button type="button" className={btn.ghost} onClick={() => setDeal('new')} disabled={pipelines.length === 0}>
                New deal
              </button>
            </div>
            {data.deals.length === 0 ? (
              <p className="text-sm text-gray-500">No deals yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.deals.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <button type="button" className="font-medium text-gray-900 hover:underline" onClick={() => setDeal(d)}>
                      {d.title}
                    </button>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DEAL_STATUS[d.status]}`}>{d.status === 'open' ? d.stageName : d.status === 'won' ? 'Won' : 'Lost'}</span>
                    <span className="ml-auto tabular-nums text-gray-700">{d.value !== null ? money(d.value, d.currency) : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">Projects</h2>
            {data.projects.length === 0 ? (
              <p className="text-sm text-gray-500">No projects yet. Win a deal to start one, or pick this client when you create a project.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.projects.map((p) => {
                  const pct = p.budgetHours ? Math.min(100, Math.round((p.hours / p.budgetHours) * 100)) : null;
                  return (
                    <li key={p.id} className="py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3">
                        <Link href={`/app/projects/${p.id}`} className="font-medium text-gray-900 hover:underline">
                          {p.name}
                        </Link>
                        <span className="text-xs text-gray-500">{PROJECT_STATUS[p.status]}</span>
                        <span className="ml-auto tabular-nums text-gray-700">
                          {p.hours} h{p.budgetHours ? ` of ${p.budgetHours} h` : ''}
                          {p.hours > 0 && p.billableHours !== p.hours && <span className="text-xs text-gray-500"> ({p.billableHours} billable)</span>}
                        </span>
                      </div>
                      {pct !== null && (
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} budget used`}>
                          <div className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Activity</h2>
            <ActivityPanel key={data.activities.map((a) => a.id).join()} target={{ companyId: c.id }} initial={data.activities} />
          </section>
        </div>
      </div>

      {editing && (
        <CompanyDialog
          company={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
      {contact && (
        <ContactDialog
          contact={contact === 'new' ? null : contact}
          companyId={c.id}
          onClose={() => setContact(null)}
          onSaved={() => {
            setContact(null);
            load();
          }}
        />
      )}
      {deal && pipelineOf(deal === 'new' ? null : deal) && (
        <DealDialog
          deal={deal === 'new' ? null : deal}
          companyId={c.id}
          pipeline={pipelineOf(deal === 'new' ? null : deal)!}
          onClose={() => {
            setDeal(null);
            load();
          }}
          onSaved={(closed) => {
            if (closed) setDeal(null);
            load();
          }}
        />
      )}
    </>
  );
}
