'use client';

import {
  companySchema,
  contactSchema,
  CURRENCIES,
  hasRole,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  leadSchema,
  type CompanyDto,
  type ContactDto,
  type CrmCompanyDto,
  type CustomValues,
  type LeadDto,
  type LeadStatus,
  type Page,
} from '@workhub/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/inbox/dialogs';
import { Alert, btn, input } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';
import { CustomInputs, DuplicateNotice, errorText, Labelled, OwnerSelect, useFields, useTeam } from './shared';

export const STATUS_LABELS: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', unqualified: 'Unqualified', converted: 'Converted' };
export const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'bg-sky-100 text-sky-800',
  contacted: 'bg-amber-100 text-amber-800',
  qualified: 'bg-emerald-100 text-emerald-800',
  unqualified: 'bg-gray-100 text-gray-600',
  converted: 'bg-brand-50 text-brand-700',
};

/** Shared footer: save, cancel and (when allowed) delete. */
function Footer({ saving, onClose, onDelete, label }: { saving: boolean; onClose: () => void; onDelete?: () => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-2 sm:col-span-2">
      <button type="submit" className={btn.primary} disabled={saving}>
        {saving ? 'Saving…' : label}
      </button>
      <button type="button" className={btn.ghost} onClick={onClose}>
        Cancel
      </button>
      {onDelete && (
        <button type="button" className={`${btn.danger} ml-auto`} onClick={onDelete}>
          Delete
        </button>
      )}
    </div>
  );
}

function useDelete(path: string, onDone: () => void, setError: (e: string) => void) {
  const api = useWorkspaceApi();
  return async (what: string) => {
    if (!confirm(`Delete ${what}? This can’t be undone from the app.`)) return;
    try {
      await api(path, { method: 'DELETE' });
      onDone();
    } catch (err) {
      setError(errorText(err, 'Could not delete it.'));
    }
  };
}

const mayDelete = (role: Parameters<typeof hasRole>[0], ownerId: string | undefined, meId: string) => hasRole(role, 'manager') || ownerId === meId;

// ---- Leads ------------------------------------------------------------------------------

export function LeadDialog({ lead, onClose, onSaved }: { lead: LeadDto | null; onClose: () => void; onSaved: () => void }) {
  const api = useWorkspaceApi();
  const { workspace, me } = useWorkspace();
  const team = useTeam();
  const fields = useFields('lead');
  const [f, setF] = useState({
    name: lead?.name ?? '',
    companyName: lead?.companyName ?? '',
    email: lead?.email ?? '',
    phone: lead?.phone ?? '',
    source: lead?.source ?? 'other',
    sourceDetail: lead?.sourceDetail ?? '',
    status: lead?.status ?? 'new',
    value: lead?.value?.toString() ?? '',
    // Blank: the workspace's own currency.
    currency: lead?.currency ?? '',
    notes: lead?.notes ?? '',
    ownerId: lead?.owner?.id ?? me.user.id,
  });
  const [custom, setCustom] = useState<CustomValues>(lead?.custom ?? {});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const converted = lead?.status === 'converted';
  const del = useDelete(`/crm/leads/${lead?.id}`, onSaved, setError);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, status: converted ? undefined : f.status, value: f.value === '' ? null : Number(f.value), currency: f.currency || undefined, ownerId: f.ownerId || null, custom };
    const parsed = (lead ? leadSchema.partial() : leadSchema).safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSaving(true);
    try {
      await api(lead ? `/crm/leads/${lead.id}` : '/crm/leads', { method: lead ? 'PATCH' : 'POST', body: { ...body, status: converted ? undefined : f.status } });
      onSaved();
    } catch (err) {
      setError(errorText(err, 'Could not save the lead.'));
      setSaving(false);
    }
  }

  if (converting && lead) return <ConvertDialog lead={lead} onClose={() => setConverting(false)} onDone={onSaved} />;

  return (
    <Modal label={lead ? lead.name : 'New lead'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <h2 className="text-base font-semibold">{lead ? 'Lead' : 'New lead'}</h2>
          {converted && (
            <span className="text-sm text-gray-600">
              Converted{' '}
              {lead.convertedContactId && (
                <Link className="text-brand-700 underline" href={`/app/crm/contacts?open=${lead.convertedContactId}`}>
                  to a contact
                </Link>
              )}
            </span>
          )}
          {lead && !converted && (
            <button type="button" className={`${btn.secondary} ml-auto !py-1.5`} onClick={() => setConverting(true)}>
              Convert to contact
            </button>
          )}
        </div>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <Labelled label="Name">
          <input value={f.name} onChange={set('name')} required maxLength={150} autoFocus className={input} />
        </Labelled>
        <Labelled label="Company">
          <input value={f.companyName} onChange={set('companyName')} maxLength={150} className={input} />
        </Labelled>
        <Labelled label="Email">
          <input type="email" value={f.email} onChange={set('email')} className={input} />
        </Labelled>
        <Labelled label="Phone or WhatsApp">
          <input type="tel" value={f.phone} onChange={set('phone')} placeholder="0300 1234567" className={input} />
        </Labelled>
        <DuplicateNotice entity="lead" query={{ email: f.email, phone: f.phone }} except={lead?.id} />
        <Labelled label="Source">
          <select value={f.source} onChange={set('source')} className={input}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label={f.source === 'referral' ? 'Referred by' : 'Source details'}>
          <input value={f.sourceDetail} onChange={set('sourceDetail')} maxLength={300} placeholder={f.source === 'upwork' || f.source === 'fiverr' ? 'Job or profile link' : ''} className={input} />
        </Labelled>
        {!converted && (
          <Labelled label="Status">
            <select value={f.status} onChange={set('status')} className={input}>
              {(['new', 'contacted', 'qualified', 'unqualified'] as const).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Labelled>
        )}
        <Labelled label="Owner">
          <OwnerSelect team={team} value={f.ownerId} onChange={(ownerId) => setF({ ...f, ownerId })} />
        </Labelled>
        <Labelled label="Estimated value">
          <span className="flex gap-2">
            <select value={f.currency} onChange={set('currency')} aria-label="Currency" className={`${input} !w-24`}>
              {!lead && <option value="">Default</option>}
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input type="number" min={0} step="any" value={f.value} onChange={set('value')} className={input} />
          </span>
        </Labelled>
        <CustomInputs fields={fields} values={custom} onChange={setCustom} />
        <Labelled label="Notes" wide>
          <textarea value={f.notes} onChange={set('notes')} rows={3} maxLength={5000} className={input} />
        </Labelled>
        <Footer saving={saving} onClose={onClose} label={lead ? 'Save' : 'Add lead'} onDelete={lead && mayDelete(workspace.role, lead.owner?.id, me.user.id) ? () => void del(`the lead “${lead.name}”`) : undefined} />
      </form>
    </Modal>
  );
}

function ConvertDialog({ lead, onClose, onDone }: { lead: LeadDto; onClose: () => void; onDone: () => void }) {
  const api = useWorkspaceApi();
  const [mode, setMode] = useState<'new' | 'existing' | 'none'>(lead.companyName ? 'new' : 'none');
  const [q, setQ] = useState(lead.companyName ?? '');
  const [matches, setMatches] = useState<CompanyDto[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [createDeal, setCreateDeal] = useState(lead.status === 'qualified' || lead.value !== null);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'existing') return;
    const t = setTimeout(() => {
      api<Page<CrmCompanyDto>>(`/crm/companies?q=${encodeURIComponent(q)}`)
        .then((p) => setMatches(p.items.slice(0, 8)))
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(t);
  }, [api, mode, q]);

  async function convert() {
    setSaving(true);
    try {
      await api(`/crm/leads/${lead.id}/convert`, { method: 'POST', body: { company: mode, companyId: mode === 'existing' ? companyId : undefined, createDeal } });
      onDone();
    } catch (err) {
      setError(errorText(err, 'Could not convert the lead.'));
      setSaving(false);
    }
  }

  return (
    <Modal label="Convert lead" onClose={onClose}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div>
          <h2 className="text-base font-semibold">Convert {lead.name}</h2>
          <p className="text-sm text-gray-500">They become a contact; their notes and owner come along.</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 text-gray-700">Company</legend>
          {lead.companyName && (
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} className="accent-brand-600" />
              Create “{lead.companyName}”
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} className="accent-brand-600" />
            Link to a company already in the CRM
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === 'none'} onChange={() => setMode('none')} className="accent-brand-600" />
            No company
          </label>
        </fieldset>
        {mode === 'existing' && (
          <div className="space-y-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" aria-label="Search companies" className={input} />
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
              {matches.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">No companies match.</li>}
              {matches.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                    <input type="radio" name="company" checked={companyId === c.id} onChange={() => setCompanyId(c.id)} className="accent-brand-600" />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Also open a deal{lead.value !== null ? ` worth ${lead.currency} ${lead.value.toLocaleString('en')}` : ''}
        </label>
        <div className="flex gap-2">
          <button type="button" className={btn.primary} disabled={saving || (mode === 'existing' && !companyId)} onClick={convert}>
            {saving ? 'Converting…' : 'Convert'}
          </button>
          <button type="button" className={btn.ghost} onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Contacts -----------------------------------------------------------------------------

export function ContactDialog({ contact, companyId, onClose, onSaved }: { contact: ContactDto | null; companyId?: string; onClose: () => void; onSaved: () => void }) {
  const api = useWorkspaceApi();
  const { workspace, me } = useWorkspace();
  const team = useTeam();
  const fields = useFields('contact');
  const [f, setF] = useState({
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    title: contact?.title ?? '',
    companyId: contact?.company?.id ?? companyId ?? '',
    notes: contact?.notes ?? '',
    ownerId: contact?.owner?.id ?? me.user.id,
  });
  const [companies, setCompanies] = useState<CompanyDto[]>(contact?.company ? [contact.company] : []);
  const [custom, setCustom] = useState<CustomValues>(contact?.custom ?? {});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const del = useDelete(`/crm/contacts/${contact?.id}`, onSaved, setError);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api<CompanyDto[]>('/companies')
      .then(setCompanies)
      .catch(() => {});
  }, [api]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, companyId: f.companyId || null, ownerId: f.ownerId || null, custom };
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSaving(true);
    try {
      await api(contact ? `/crm/contacts/${contact.id}` : '/crm/contacts', { method: contact ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (err) {
      setError(errorText(err, 'Could not save the contact.'));
      setSaving(false);
    }
  }

  return (
    <Modal label={contact ? contact.name : 'New contact'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
        <h2 className="text-base font-semibold sm:col-span-2">{contact ? 'Contact' : 'New contact'}</h2>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <Labelled label="First name">
          <input value={f.firstName} onChange={set('firstName')} required maxLength={100} autoFocus className={input} />
        </Labelled>
        <Labelled label="Last name">
          <input value={f.lastName} onChange={set('lastName')} maxLength={100} className={input} />
        </Labelled>
        <Labelled label="Email">
          <input type="email" value={f.email} onChange={set('email')} className={input} />
        </Labelled>
        <Labelled label="Phone or WhatsApp">
          <input type="tel" value={f.phone} onChange={set('phone')} placeholder="0300 1234567" className={input} />
        </Labelled>
        <DuplicateNotice entity="contact" query={{ email: f.email, phone: f.phone }} except={contact?.id} />
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
        <Labelled label="Job title">
          <input value={f.title} onChange={set('title')} maxLength={100} className={input} />
        </Labelled>
        <Labelled label="Owner">
          <OwnerSelect team={team} value={f.ownerId} onChange={(ownerId) => setF({ ...f, ownerId })} />
        </Labelled>
        <CustomInputs fields={fields} values={custom} onChange={setCustom} />
        <Labelled label="Notes" wide>
          <textarea value={f.notes} onChange={set('notes')} rows={3} maxLength={5000} className={input} />
        </Labelled>
        <Footer saving={saving} onClose={onClose} label={contact ? 'Save' : 'Add contact'} onDelete={contact && mayDelete(workspace.role, contact.owner?.id, me.user.id) ? () => void del(contact.name) : undefined} />
      </form>
    </Modal>
  );
}

// ---- Companies ----------------------------------------------------------------------------

export function CompanyDialog({ company, onClose, onSaved }: { company: CrmCompanyDto | null; onClose: () => void; onSaved: (c: CrmCompanyDto) => void }) {
  const api = useWorkspaceApi();
  const { me } = useWorkspace();
  const team = useTeam();
  const fields = useFields('company');
  const [f, setF] = useState({
    name: company?.name ?? '',
    website: company?.website ?? '',
    email: company?.email ?? '',
    phone: company?.phone ?? '',
    industry: company?.industry ?? '',
    city: company?.city ?? '',
    country: company?.country ?? '',
    address: company?.address ?? '',
    notes: company?.notes ?? '',
    ownerId: company?.owner?.id ?? me.user.id,
  });
  const [custom, setCustom] = useState<CustomValues>(company?.custom ?? {});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, ownerId: f.ownerId || null, custom };
    const parsed = companySchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSaving(true);
    try {
      onSaved(await api<CrmCompanyDto>(company ? `/crm/companies/${company.id}` : '/crm/companies', { method: company ? 'PATCH' : 'POST', body }));
    } catch (err) {
      setError(errorText(err, 'Could not save the company.'));
      setSaving(false);
    }
  }

  return (
    <Modal label={company ? company.name : 'New company'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
        <h2 className="text-base font-semibold sm:col-span-2">{company ? 'Edit company' : 'New company'}</h2>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <Labelled label="Name">
          <input value={f.name} onChange={set('name')} required maxLength={150} autoFocus className={input} />
        </Labelled>
        <Labelled label="Website">
          <input value={f.website} onChange={set('website')} placeholder="acme.pk" maxLength={200} className={input} />
        </Labelled>
        <DuplicateNotice entity="company" query={{ name: f.name, website: f.website }} except={company?.id} />
        <Labelled label="Email">
          <input type="email" value={f.email} onChange={set('email')} className={input} />
        </Labelled>
        <Labelled label="Phone">
          <input type="tel" value={f.phone} onChange={set('phone')} className={input} />
        </Labelled>
        <Labelled label="Industry">
          <input value={f.industry} onChange={set('industry')} maxLength={80} className={input} />
        </Labelled>
        <Labelled label="Owner">
          <OwnerSelect team={team} value={f.ownerId} onChange={(ownerId) => setF({ ...f, ownerId })} />
        </Labelled>
        <Labelled label="City">
          <input value={f.city} onChange={set('city')} maxLength={80} className={input} />
        </Labelled>
        <Labelled label="Country">
          <input value={f.country} onChange={set('country')} maxLength={80} className={input} />
        </Labelled>
        <Labelled label="Address" wide>
          <input value={f.address} onChange={set('address')} maxLength={300} className={input} />
        </Labelled>
        <CustomInputs fields={fields} values={custom} onChange={setCustom} />
        <Labelled label="Notes" wide>
          <textarea value={f.notes} onChange={set('notes')} rows={3} maxLength={5000} className={input} />
        </Labelled>
        <Footer saving={saving} onClose={onClose} label={company ? 'Save' : 'Add company'} />
      </form>
    </Modal>
  );
}
