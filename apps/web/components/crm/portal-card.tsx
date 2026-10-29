'use client';

import { hasRole, type CompanyPortalDto } from '@workhub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, btn, input } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';
import { errorText } from './shared';

/** On a client's page: who sees its portal, which projects are shared, and a preview. */
export function ClientPortalCard({ companyId, companyName }: { companyId: string; companyName: string }) {
  const api = useWorkspaceApi();
  const { workspace } = useWorkspace();
  const admin = hasRole(workspace.role, 'admin');
  const [data, setData] = useState<CompanyPortalDto>();
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<{ kind: 'error' | 'success'; text: string }>();

  const load = useCallback(() => {
    api<CompanyPortalDto>(`/portal/companies/${companyId}`)
      .then(setData)
      .catch((err) => setResult({ kind: 'error', text: errorText(err, 'Could not load the portal settings.') }));
  }, [api, companyId]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<CompanyPortalDto>, done?: string) {
    setResult(undefined);
    try {
      setData(await fn());
      if (done) setResult({ kind: 'success', text: done });
    } catch (err) {
      setResult({ kind: 'error', text: errorText(err, 'That didn’t work.') });
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="portal-title">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 id="portal-title" className="text-sm font-semibold">
          Client portal
        </h2>
        <Link href={`/app/portal?company=${companyId}`} className="text-xs text-brand-700 underline">
          Preview
        </Link>
      </div>
      <p className="mb-3 text-xs text-gray-500">Contacts at {companyName} sign in to follow shared projects, approved hours, and the quotes and invoices you send. Contacts are free guests.</p>
      <div className="space-y-4" aria-live="polite">
        {result && <Alert kind={result.kind}>{result.text}</Alert>}
        {!data ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium text-gray-500">Shared projects</p>
              {data.projects.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">No projects for this client yet.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {data.projects.map((p) => (
                    <li key={p.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={p.portalVisible}
                          onChange={(e) => void run(() => api<CompanyPortalDto>(`/portal/projects/${p.id}/visibility`, { method: 'POST', body: { visible: e.target.checked } }))}
                        />
                        {p.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-gray-500">Contacts</p>
              {data.people.length === 0 && data.invites.length === 0 && <p className="mt-1 text-sm text-gray-500">Nobody yet.</p>}
              <ul className="mt-1 space-y-1 text-sm">
                {data.people.map((p) => (
                  <li key={p.userId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {p.name} <span className="text-gray-500">{p.email}</span>
                    </span>
                    {admin && (
                      <button
                        type="button"
                        className="shrink-0 text-xs text-red-600 hover:underline"
                        onClick={() => confirm(`Remove ${p.name}’s access?`) && void run(() => api<CompanyPortalDto>(`/portal/companies/${companyId}/people/${p.userId}`, { method: 'DELETE' }), 'Access removed.')}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
                {data.invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 text-gray-500">
                    <span className="min-w-0 truncate">{i.email} · invited</span>
                    {admin && (
                      <button type="button" className="shrink-0 text-xs hover:underline" onClick={() => void run(() => api<CompanyPortalDto>(`/portal/companies/${companyId}/invites/${i.id}`, { method: 'DELETE' }))}>
                        Cancel
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {admin && (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const next = await api<CompanyPortalDto>(`/portal/companies/${companyId}/invite`, { method: 'POST', body: { email } });
                      setEmail('');
                      return next;
                    }, `Invitation sent to ${email}.`);
                  }}
                >
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" aria-label="Contact’s email" required className={`${input} min-w-0`} />
                  <button type="submit" className={`${btn.secondary} shrink-0`}>
                    Invite
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
