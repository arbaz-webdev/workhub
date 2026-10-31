'use client';

import { hasRole, type CrmEntity, type CustomFieldDto, type CustomValues, type DuplicateDto, type MemberDto, type Role } from '@workhub/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, input, PageHeader } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const TABS: { href: string; label: string; minRole: Role }[] = [
  { href: '/app/crm/deals', label: 'Deals', minRole: 'member' },
  { href: '/app/crm/follow-ups', label: 'Follow-ups', minRole: 'member' },
  { href: '/app/crm/leads', label: 'Leads', minRole: 'member' },
  { href: '/app/crm/contacts', label: 'Contacts', minRole: 'member' },
  { href: '/app/crm/companies', label: 'Companies', minRole: 'member' },
  { href: '/app/crm/invoices', label: 'Quotes & invoices', minRole: 'manager' },
  { href: '/app/crm/import', label: 'Import', minRole: 'manager' },
  { href: '/app/crm/pipelines', label: 'Pipelines', minRole: 'manager' },
  { href: '/app/crm/fields', label: 'Custom fields', minRole: 'manager' },
];

/** Quotes and invoices to clients are for managers and up (as the API is); others get a plain message. */
export function ManagersOnly({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace();
  if (hasRole(workspace.role, 'manager')) return <>{children}</>;
  return (
    <>
      <PageHeader title="CRM" />
      <CrmTabs />
      <Alert>Only managers can see quotes and invoices to clients.</Alert>
    </>
  );
}

export function CrmTabs() {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  return (
    <nav aria-label="CRM" className="mb-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-sm [scrollbar-width:none]">
      {TABS.filter((t) => hasRole(workspace.role, t.minRole)).map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors duration-200 ${active ? 'bg-ink font-medium text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-ink'}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback;
}

/** People who can own CRM records (everyone but guests). */
export function useTeam() {
  const api = useWorkspaceApi();
  const [team, setTeam] = useState<MemberDto[]>([]);
  useEffect(() => {
    api<MemberDto[]>('/members')
      .then((m) => setTeam(m.filter((x) => x.role !== 'guest')))
      .catch(() => {});
  }, [api]);
  return team;
}

export function useFields(entity: CrmEntity) {
  const api = useWorkspaceApi();
  const [fields, setFields] = useState<CustomFieldDto[]>([]);
  useEffect(() => {
    api<CustomFieldDto[]>(`/crm/fields?entity=${entity}`)
      .then(setFields)
      .catch(() => {});
  }, [api, entity]);
  return fields;
}

export function Labelled({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-gray-700">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export function OwnerSelect({ team, value, onChange }: { team: MemberDto[]; value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">No owner</option>
      {team.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

/** Inputs for the workspace's custom fields. */
export function CustomInputs({ fields, values, onChange }: { fields: CustomFieldDto[]; values: CustomValues; onChange: (next: CustomValues) => void }) {
  if (fields.length === 0) return null;
  const set = (key: string, v: CustomValues[string]) => onChange({ ...values, [key]: v });
  return (
    <>
      {fields.map((f) => {
        const v = values[f.key];
        if (f.type === 'checkbox') {
          return (
            <label key={f.id} className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={v === true} onChange={(e) => set(f.key, e.target.checked)} className="h-4 w-4 accent-brand-600" />
              {f.label}
            </label>
          );
        }
        return (
          <Labelled key={f.id} label={f.label}>
            {f.type === 'select' ? (
              <select value={typeof v === 'string' ? v : ''} onChange={(e) => set(f.key, e.target.value || null)} className={input}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'}
                value={v === null || v === undefined || typeof v === 'boolean' ? '' : String(v)}
                onChange={(e) => set(f.key, e.target.value === '' ? null : f.type === 'number' ? Number(e.target.value) : e.target.value)}
                className={input}
              />
            )}
          </Labelled>
        );
      })}
    </>
  );
}

const REASON: Record<DuplicateDto['reason'], string> = { email: 'same email', phone: 'same phone', website: 'same website', name: 'same name' };
const HREF: Record<CrmEntity, (id: string) => string> = {
  company: (id) => `/app/crm/companies/${id}`,
  contact: (id) => `/app/crm/contacts?open=${id}`,
  lead: (id) => `/app/crm/leads?open=${id}`,
};

/** Warns, while typing, about records that look like this one. Saving is still allowed. */
export function DuplicateNotice({ entity, query, except }: { entity: CrmEntity; query: { email?: string; phone?: string; name?: string; website?: string }; except?: string }) {
  const api = useWorkspaceApi();
  const [found, setFound] = useState<DuplicateDto[]>([]);
  const key = JSON.stringify(query);

  useEffect(() => {
    const q = JSON.parse(key) as Record<string, string | undefined>;
    const params = new URLSearchParams({ entity });
    for (const [k, v] of Object.entries(q)) if (v && v.trim().length >= 3) params.set(k, v.trim());
    if (except) params.set('except', except);
    if ([...params.keys()].length <= (except ? 2 : 1)) {
      setFound([]);
      return;
    }
    const t = setTimeout(() => {
      api<DuplicateDto[]>(`/crm/duplicates?${params}`)
        .then(setFound)
        .catch(() => setFound([]));
    }, 400);
    return () => clearTimeout(t);
  }, [api, entity, key, except]);

  if (found.length === 0) return null;
  return (
    <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2">
      <p className="font-medium">This may already be in your CRM:</p>
      <ul className="mt-1 space-y-0.5">
        {found.map((d) => (
          <li key={`${d.entity}-${d.id}`}>
            <Link href={HREF[d.entity](d.id)} className="underline">
              {d.label}
            </Link>{' '}
            <span className="text-amber-700">
              ({d.entity}, {REASON[d.reason]})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A plain search box that reports after a pause in typing. */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => text !== value && onChange(text), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${input} sm:!w-72`} />;
}

export function Pager({ page, total, size = 50, onPage }: { page: number; total: number; size?: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm text-gray-600">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg px-2 py-1 hover:bg-gray-100 disabled:opacity-40">
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-lg px-2 py-1 hover:bg-gray-100 disabled:opacity-40">
        Next
      </button>
    </div>
  );
}
