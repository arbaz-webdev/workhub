'use client';

import { createApiKeySchema, hasRole, type ApiKeyAccess, type ApiKeyCreatedDto, type ApiKeyDto } from '@workhub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SettingsTabs } from '@/components/settings/tabs';
import { Webhooks } from '@/components/settings/webhooks';
import { Alert, Card, PageHeader, btn, input, timeAgo, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const ACCESS_LABEL: Record<ApiKeyAccess, string> = { read: 'Read only', write: 'Read and write' };

export default function ApiSettingsPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const isAdmin = hasRole(workspace.role, 'admin');
  const [keys, setKeys] = useState<ApiKeyDto[]>();
  const [created, setCreated] = useState<ApiKeyCreatedDto | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    if (!isAdmin) return;
    api<ApiKeyDto[]>('/api-keys')
      .then(setKeys)
      .catch(() => setError('Could not load your API keys.'));
  }, [api, isAdmin]);
  useEffect(load, [load]);

  async function revoke(key: ApiKeyDto) {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working straight away.`)) return;
    setError(undefined);
    try {
      await api(`/api-keys/${key.id}`, { method: 'DELETE' });
      if (created?.id === key.id) setCreated(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke the key.');
    }
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Settings" />
        <SettingsTabs />
        <Alert>Only owners and admins can manage API keys.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" description="Connect WorkHub to your own software, such as payroll or accounting." />
      <SettingsTabs />
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {created && <NewKey created={created} onDone={() => setCreated(null)} />}

        <Card
          title="API keys"
          description="A key lets other software use this workspace's data. It acts as you, with your access, and stops working if you leave or stop being an admin."
        >
          {!keys ? (
            <Loading />
          ) : keys.length === 0 ? (
            <p className="text-sm text-gray-500">No API keys yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">
                      {k.name}
                      <span className="ms-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-600">{ACCESS_LABEL[k.access]}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      <code className="font-mono">{k.prefix}…</code> · Created by {k.createdBy?.name ?? 'a former member'} {timeAgo(k.createdAt)} ·{' '}
                      {k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : 'never used'}
                    </p>
                    {!k.active && <p className="mt-1 text-xs font-medium text-amber-700">Not working: the person who created it is no longer an admin. Create a new key.</p>}
                  </div>
                  <button type="button" className={btn.danger} onClick={() => revoke(k)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          <CreateKey onCreated={(k) => (setCreated(k), setError(undefined), load())} onError={setError} />
        </Card>

        <Webhooks />

        <p className="text-sm text-gray-600">
          How to use keys and webhooks, with examples:{' '}
          <Link href="/developers" className="font-medium text-brand-700 underline">
            WorkHub API documentation
          </Link>
          .
        </p>
      </div>
    </>
  );
}

function CreateKey({ onCreated, onError }: { onCreated: (k: ApiKeyCreatedDto) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [name, setName] = useState('');
  const [access, setAccess] = useState<ApiKeyAccess>('read');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createApiKeySchema.safeParse({ name, access });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Check the key details.');
    setSaving(true);
    try {
      onCreated(await api<ApiKeyCreatedDto>('/api-keys', { method: 'POST', body: parsed.data }));
      setName('');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not create the key.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 text-sm">
      <label className="min-w-48 flex-1">
        <span className="text-gray-700">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payroll sync" maxLength={80} className={`mt-1 ${input}`} required />
      </label>
      <label>
        <span className="text-gray-700">Access</span>
        <select value={access} onChange={(e) => setAccess(e.target.value as ApiKeyAccess)} className={`mt-1 ${input}`}>
          <option value="read">{ACCESS_LABEL.read}</option>
          <option value="write">{ACCESS_LABEL.write}</option>
        </select>
      </label>
      <button type="submit" className={btn.primary} disabled={saving}>
        {saving ? 'Creating…' : 'Create key'}
      </button>
      <p className="w-full text-xs text-gray-500">Read and write keys can also add and change tasks, leads, contacts and activities. Choose read only unless the other software needs to.</p>
    </form>
  );
}

/** The new key, shown once. */
function NewKey({ created, onDone }: { created: ApiKeyCreatedDto; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card title={`Your new key: ${created.name}`} description="Copy it now and keep it somewhere safe, like a password. You won't be able to see it again.">
      <code className="block break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900">{created.key}</code>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={btn.secondary}
          onClick={() => {
            void navigator.clipboard?.writeText(created.key);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy key'}
        </button>
        <button type="button" className={btn.primary} onClick={onDone}>
          I&apos;ve saved it
        </button>
      </div>
    </Card>
  );
}
