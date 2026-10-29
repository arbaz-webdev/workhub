'use client';

import { AUDIT_ACTION_LABELS, hasRole, WORKSPACE_HEADER, type AuditLogDto, type AuditLogPage } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, PageHeader, btn } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

function describe(entry: AuditLogDto): string {
  const m = entry.metadata as Record<string, unknown>;
  switch (entry.action) {
    case 'team.created':
      return String(m.name ?? '');
    case 'invitation.created':
      return m.link ? `Join link · ${m.role}` : `${m.email} · ${m.role}`;
    case 'invitation.revoked':
      return String(m.email ?? 'Join link');
    case 'member.joined':
      return `as ${m.role}${m.via === 'link' ? ' via join link' : ''}`;
    case 'member.role_changed':
      return `${m.from} → ${m.to}`;
    case 'member.removed':
      return `${m.name} (${m.email})`;
    case 'workspace.updated':
      return Object.keys(m).join(', ');
    default:
      return '';
  }
}

export default function AuditLogPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [items, setItems] = useState<AuditLogDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (before?: string) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (before) params.set('before', before);
      if (action) params.set('action', action);
      try {
        const page = await api<AuditLogPage>(`/audit-logs?${params}`);
        setItems((cur) => (before ? [...cur, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch {
        setError('Could not load the audit log.');
      } finally {
        setLoading(false);
      }
    },
    [api, action],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    // A plain link can't send the workspace header, so download through fetch.
    const params = action ? `?action=${encodeURIComponent(action)}` : '';
    const res = await fetch(`/api/audit-logs/export${params}`, { headers: { [WORKSPACE_HEADER]: workspace.id } });
    if (!res.ok) {
      setError('Could not export the audit log.');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${workspace.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!hasRole(workspace.role, 'admin')) {
    return <Alert>Only admins and the owner can see the audit log.</Alert>;
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, and when. Kept for one year."
        action={
          <button onClick={exportCsv} className={btn.secondary}>
            Export CSV
          </button>
        }
      />
      <Card>
        <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
          Show
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All activity</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error && <Alert>{error}</Alert>}
        <div className="-mx-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-6 pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Who</th>
                <th className="pb-2 font-medium">What</th>
                <th className="px-6 pb-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 align-top last:border-0">
                  <td className="whitespace-nowrap px-6 py-2.5 text-gray-500">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="py-2.5">{e.actorName ?? <span className="text-gray-400">Deleted user</span>}</td>
                  <td className="py-2.5">{AUDIT_ACTION_LABELS[e.action] ?? e.action}</td>
                  <td className="px-6 py-2.5 text-gray-600">{describe(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && items.length === 0 && <p className="py-6 text-center text-sm text-gray-500">Nothing here yet.</p>}
        {cursor && (
          <div className="mt-4 text-center">
            <button onClick={() => load(cursor)} disabled={loading} className={btn.secondary}>
              {loading ? 'Loading…' : 'Load older'}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
