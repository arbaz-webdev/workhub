'use client';

import type { CrmCompanyDto, Page } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CompanyDialog } from '@/components/crm/dialogs';
import { CrmTabs, Pager, SearchBox } from '@/components/crm/shared';
import { Alert, PageHeader, btn } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

export default function CompaniesPage() {
  const api = useWorkspaceApi();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<CrmCompanyDto>>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (q) p.set('q', q);
    api<Page<CrmCompanyDto>>(`/crm/companies?${p}`)
      .then(setData)
      .catch(() => setError('Could not load companies.'));
  }, [api, q, page]);
  useEffect(load, [load]);

  return (
    <>
      <PageHeader
        title="CRM"
        description="Your clients and prospects. Projects are linked to them, so hours roll up."
        action={
          <button type="button" className={btn.primary} onClick={() => setCreating(true)}>
            New company
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
          placeholder="Search name, website, city, industry"
        />
        {data && <span className="ms-auto text-sm text-gray-500">{data.total.toLocaleString()} companies</span>}
      </div>
      {!data ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <p className="font-medium text-gray-800">{q ? 'No companies match' : 'No companies yet'}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-start text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">City</th>
                  <th className="px-3 py-2 text-end">Contacts</th>
                  <th className="px-3 py-2 text-end">Projects</th>
                  <th className="px-3 py-2">Owner</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link href={`/app/crm/companies/${c.id}`} className="font-medium text-gray-900 hover:underline">
                        {c.name}
                      </Link>
                      {(c.industry || c.website) && <span className="block truncate text-xs text-gray-500">{c.industry ?? c.website?.replace(/^https?:\/\//, '')}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{c.city ?? '—'}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{c.contactCount}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{c.projectCount}</td>
                    <td className="px-3 py-2 text-gray-700">{c.owner?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} onPage={setPage} />
        </>
      )}
      {creating && <CompanyDialog company={null} onClose={() => setCreating(false)} onSaved={(c) => router.push(`/app/crm/companies/${c.id}`)} />}
    </>
  );
}
