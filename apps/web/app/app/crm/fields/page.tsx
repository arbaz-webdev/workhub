'use client';

import { CUSTOM_FIELD_TYPES, customFieldSchema, hasRole, type CrmEntity, type CustomFieldDto, type CustomFieldType } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { CrmTabs, errorText } from '@/components/crm/shared';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const ENTITY_LABEL: Record<CrmEntity, string> = { lead: 'Leads', contact: 'Contacts', company: 'Companies' };
const TYPE_LABEL: Record<CustomFieldType, string> = { text: 'Text', number: 'Number', date: 'Date', select: 'Choice from a list', checkbox: 'Yes / no', url: 'Link' };

export default function FieldsPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [fields, setFields] = useState<CustomFieldDto[]>();
  const [entity, setEntity] = useState<CrmEntity>('lead');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<CustomFieldDto[]>('/crm/fields')
      .then(setFields)
      .catch(() => setError('Could not load fields.'));
  }, [api]);
  useEffect(load, [load]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title="CRM" />
        <CrmTabs />
        <Alert>Only managers can change custom fields.</Alert>
      </>
    );
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const parsed = customFieldSchema.safeParse({ entity, label, type, options: options.split(',').map((o) => o.trim()).filter(Boolean) });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    try {
      await api('/crm/fields', { method: 'POST', body: parsed.data });
      setLabel('');
      setOptions('');
      setError(undefined);
      load();
    } catch (err) {
      setError(errorText(err, 'Could not add the field.'));
    }
  }

  async function remove(f: CustomFieldDto) {
    if (!confirm(`Remove “${f.label}”? It disappears from forms; values already saved are kept.`)) return;
    await api(`/crm/fields/${f.id}`, { method: 'DELETE' }).catch(() => setError('Could not remove it.'));
    load();
  }

  return (
    <>
      <PageHeader title="CRM" description="Extra fields for what your business tracks: budget band, industry, NTN number, preferred language…" />
      <CrmTabs />
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        <Card title="Add a field">
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="text-gray-700">On</span>
              <select value={entity} onChange={(e) => setEntity(e.target.value as CrmEntity)} className={`mt-1 ${input} !w-36`}>
                {(['lead', 'contact', 'company'] as const).map((x) => (
                  <option key={x} value={x}>
                    {ENTITY_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-gray-700">Name</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={60} className={`mt-1 ${input} !w-52`} />
            </label>
            <label className="block text-sm">
              <span className="text-gray-700">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className={`mt-1 ${input} !w-44`}>
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {type === 'select' && (
              <label className="block text-sm">
                <span className="text-gray-700">Choices, separated by commas</span>
                <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Small, Medium, Large" className={`mt-1 ${input} !w-64`} />
              </label>
            )}
            <button type="submit" className={btn.primary}>
              Add field
            </button>
          </form>
        </Card>

        {(['lead', 'contact', 'company'] as const).map((x) => {
          const list = fields?.filter((f) => f.entity === x) ?? [];
          return (
            <Card key={x} title={ENTITY_LABEL[x]}>
              {list.length === 0 ? (
                <p className="text-sm text-gray-500">No custom fields.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {list.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <span className="font-medium">{f.label}</span>
                      <span className="text-gray-500">
                        {TYPE_LABEL[f.type]}
                        {f.type === 'select' && `: ${f.options.join(', ')}`}
                      </span>
                      <code className="text-xs text-gray-400">{f.key}</code>
                      <button type="button" className={`${btn.danger} ml-auto`} onClick={() => void remove(f)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
