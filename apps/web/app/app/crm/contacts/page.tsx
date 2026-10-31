'use client';

import type { ContactDto, Page } from '@workhub/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ContactDialog } from '@/components/crm/dialogs';
import { CrmTabs, Pager, SearchBox } from '@/components/crm/shared';
import { Alert, PageHeader, btn, Loading } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

export default function ContactsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Contacts />
    </Suspense>
  );
}

function Contacts() {
  const api = useWorkspaceApi();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('open');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<ContactDto>>();
  const [editing, setEditing] = useState<ContactDto | 'new' | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (q) p.set('q', q);
    api<Page<ContactDto>>(`/crm/contacts?${p}`)
      .then(setData)
      .catch(() => setError('Could not load contacts.'));
  }, [api, q, page]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!openId) return;
    api<ContactDto>(`/crm/contacts/${openId}`)
      .then(setEditing)
      .catch(() => setError('That contact isn’t available any more.'));
  }, [api, openId]);

  const close = () => {
    setEditing(null);
    if (openId) router.replace('/app/crm/contacts', { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="CRM"
        description="The people you work with."
        action={
          <button type="button" className={btn.primary} onClick={() => setEditing('new')}>
            New contact
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
          placeholder="Search name, email, phone, title"
        />
        {data && <span className="ml-auto text-sm text-gray-500">{data.total.toLocaleString()} contacts</span>}
      </div>
      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center">
          <p className="font-medium text-gray-800">{q ? 'No contacts match' : 'No contacts yet'}</p>
          <p className="mt-1 text-sm text-gray-500">Converted leads land here too.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-3xl bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Owner</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <button type="button" className="text-left font-medium text-gray-900 hover:underline" onClick={() => setEditing(c)}>
                        {c.name}
                      </button>
                      {c.title && <span className="block text-xs text-gray-500">{c.title}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {c.company ? (
                        <Link href={`/app/crm/companies/${c.company.id}`} className="text-brand-700 hover:underline">
                          {c.company.name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{c.email ? <a href={`mailto:${c.email}`} className="text-gray-700 hover:underline">{c.email}</a> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="text-gray-700 hover:underline">{c.phone}</a> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{c.owner?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} onPage={setPage} />
        </>
      )}
      {editing && (
        <ContactDialog
          contact={editing === 'new' ? null : editing}
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
