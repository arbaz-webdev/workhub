'use client';

import { hasRole, type CompanyPageDto, type ContactDto, type CustomFieldDto } from '@workhub/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CompanyDialog, ContactDialog } from '@/components/crm/dialogs';
import { errorText, useFields } from '@/components/crm/shared';
import { Alert, btn } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const PROJECT_STATUS: Record<string, string> = { active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' };

function show(f: CustomFieldDto, v: unknown) {
  if (v === null || v === undefined) return null;
  if (f.type === 'checkbox') return v ? 'Yes' : 'No';
  if (f.type === 'date') return new Date(`${String(v)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return String(v);
}

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const api = useWorkspaceApi();
  const router = useRouter();
  const { workspace, me } = useWorkspace();
  const fields = useFields('company');
  const [data, setData] = useState<CompanyPageDto>();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<ContactDto | 'new' | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<CompanyPageDto>(`/crm/companies/${id}`)
      .then(setData)
      .catch(() => setError('This company isn’t available. It may have been deleted.'));
  }, [api, id]);
  useEffect(load, [load]);

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

  return (
    <>
      <Link href="/app/crm/companies" className="text-sm text-brand-700 hover:underline">
        ← Companies
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
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

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-1">
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

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">People ({data.contacts.length})</h2>
              <button type="button" className={btn.ghost} onClick={() => setContact('new')}>
                Add contact
              </button>
            </div>
            {data.contacts.length === 0 ? (
              <p className="text-sm text-gray-500">No contacts yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.contacts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 py-2 text-sm">
                    <button type="button" className="font-medium text-gray-900 hover:underline" onClick={() => setContact(p)}>
                      {p.name}
                    </button>
                    {p.title && <span className="text-gray-500">{p.title}</span>}
                    <span className="ml-auto text-gray-600">{p.email ?? p.phone}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Projects ({data.projects.length})</h2>
            {data.projects.length === 0 ? (
              <p className="text-sm text-gray-500">No projects for this client yet. Pick it as the client when you create a project.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/app/projects/${p.id}`} className="font-medium text-gray-900 hover:underline">
                      {p.name}
                    </Link>
                    <span className="text-xs text-gray-500">{PROJECT_STATUS[p.status]}</span>
                  </li>
                ))}
              </ul>
            )}
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
    </>
  );
}
