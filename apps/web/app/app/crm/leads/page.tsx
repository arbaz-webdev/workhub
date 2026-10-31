'use client';

import { LEAD_SOURCE_LABELS, LEAD_SOURCES, LEAD_STATUSES, type LeadDto, type Page } from '@workhub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { LeadDialog, STATUS_COLORS, STATUS_LABELS } from '@/components/crm/dialogs';
import { CrmTabs, Pager, SearchBox } from '@/components/crm/shared';
import { Alert, PageHeader, btn, input, timeAgo, Loading } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

export default function LeadsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Leads />
    </Suspense>
  );
}

const money = (v: number, currency: string) => `${currency} ${v.toLocaleString('en', { maximumFractionDigits: 0 })}`;

function Leads() {
  const api = useWorkspaceApi();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('open');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<LeadDto>>();
  const [editing, setEditing] = useState<LeadDto | 'new' | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (source) p.set('source', source);
    api<Page<LeadDto>>(`/crm/leads?${p}`)
      .then(setData)
      .catch(() => setError('Could not load leads.'));
  }, [api, q, status, source, page]);
  useEffect(load, [load]);

  // Opened from a link (a duplicate warning, a notification): show that lead.
  useEffect(() => {
    if (!openId) return;
    api<LeadDto>(`/crm/leads/${openId}`)
      .then(setEditing)
      .catch(() => setError('That lead isn’t available any more.'));
  }, [api, openId]);

  const close = () => {
    setEditing(null);
    if (openId) router.replace('/app/crm/leads', { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="CRM"
        description="Leads from Upwork, Fiverr, LinkedIn, WhatsApp, referrals and your website."
        action={
          <button type="button" className={btn.primary} onClick={() => setEditing('new')}>
            New lead
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
        <SearchBox
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search name, company, email, phone"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Status"
          className={`${input} !w-40`}
        >
          <option value="">Any status</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPage(1);
          }}
          aria-label="Source"
          className={`${input} !w-40`}
        >
          <option value="">Any source</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {LEAD_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        {data && <span className="ml-auto text-sm text-gray-500">{data.total.toLocaleString()} leads</span>}
      </div>

      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center">
          <p className="font-medium text-gray-800">{q || status || source ? 'No leads match' : 'No leads yet'}</p>
          <p className="mt-1 text-sm text-gray-500">Add one by hand, or bring in a spreadsheet from the Import tab.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-3xl bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Added</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((l) => (
                  <tr key={l.id} onClick={() => setEditing(l)} className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <button type="button" className="text-left font-medium text-gray-900 hover:underline" onClick={() => setEditing(l)}>
                        {l.name}
                      </button>
                      <span className="block text-xs text-gray-500">{[l.companyName, l.email ?? l.phone].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{LEAD_SOURCE_LABELS[l.source]}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[l.status]}`}>{STATUS_LABELS[l.status]}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{l.value !== null ? money(l.value, l.currency) : '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{l.owner?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{timeAgo(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} onPage={setPage} />
        </>
      )}

      {editing && (
        <LeadDialog
          lead={editing === 'new' ? null : editing}
          onClose={close}
          onSaved={() => {
            close();
            load();
          }}
        />
      )}
    </>
  );
}
