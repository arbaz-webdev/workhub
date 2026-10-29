'use client';

import {
  ASSIGNABLE_ROLES,
  hasRole,
  inviteByEmailSchema,
  type AssignableRole,
  type InvitationDto,
  type InviteLinkResponse,
  type MemberDto,
} from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, PageHeader, btn, input, roleLabel, timeAgo } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Pulls every email address out of pasted text or a CSV file. */
function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

export default function PeoplePage() {
  const { me, workspace, refresh } = useWorkspace();
  const api = useWorkspaceApi();
  const isAdmin = hasRole(workspace.role, 'admin');
  const [members, setMembers] = useState<MemberDto[]>();
  const [invites, setInvites] = useState<InvitationDto[]>([]);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<MemberDto[]>('/members').then(setMembers).catch((e) => setError(errorMessage(e, 'Could not load people.')));
    if (isAdmin) api<InvitationDto[]>('/invitations').then(setInvites).catch(() => {});
  }, [api, isAdmin]);

  useEffect(load, [load]);

  // Who can change whom: never the owner or yourself; admins only by the owner.
  function canManage(m: MemberDto) {
    if (!isAdmin || m.userId === me.user.id || m.role === 'owner') return false;
    return m.role !== 'admin' || workspace.role === 'owner';
  }
  const assignable = ASSIGNABLE_ROLES.filter((r) => r !== 'admin' || workspace.role === 'owner');

  async function changeRole(m: MemberDto, role: AssignableRole) {
    setError(undefined);
    try {
      await api(`/members/${m.userId}`, { method: 'PATCH', body: { role } });
      load();
    } catch (e) {
      setError(errorMessage(e, 'Could not change the role.'));
    }
  }

  async function remove(m: MemberDto) {
    if (!window.confirm(`Remove ${m.name} from ${workspace.name}? They will lose access straight away.`)) return;
    setError(undefined);
    try {
      await api(`/members/${m.userId}`, { method: 'DELETE' });
      load();
      void refresh();
    } catch (e) {
      setError(errorMessage(e, 'Could not remove this person.'));
    }
  }

  async function revoke(inv: InvitationDto) {
    try {
      await api(`/invitations/${inv.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(errorMessage(e, 'Could not cancel the invitation.'));
    }
  }

  return (
    <>
      <PageHeader title="People" description={`Everyone in ${workspace.name} and what they can do.`} />
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}

        <Card title={members ? `Members (${members.length})` : 'Members'}>
          {!members ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-start text-xs text-gray-500">
                    <th className="px-6 pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Role</th>
                    <th className="pb-2 font-medium">Joined</th>
                    <th className="px-6 pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId} className="border-b border-gray-50 last:border-0">
                      <td className="px-6 py-3">
                        <p className="font-medium">
                          {m.name}
                          {m.userId === me.user.id && <span className="text-gray-400"> (you)</span>}
                        </p>
                        <p className="text-xs text-gray-500">{m.email}</p>
                      </td>
                      <td className="py-3">
                        {canManage(m) ? (
                          <select
                            aria-label={`Role for ${m.name}`}
                            value={m.role}
                            onChange={(e) => changeRole(m, e.target.value as AssignableRole)}
                            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                          >
                            {assignable.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          roleLabel(m.role)
                        )}
                      </td>
                      <td className="py-3 text-gray-500">{new Date(m.joinedAt).toLocaleDateString()}</td>
                      <td className="px-6 py-3 text-end">
                        {canManage(m) && (
                          <button onClick={() => remove(m)} className={btn.danger}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {isAdmin && (
          <>
            <InviteByEmail assignable={assignable} onDone={load} />
            <InviteLink onDone={load} />
            {invites.length > 0 && (
              <Card title={`Pending invitations (${invites.length})`}>
                <ul className="divide-y divide-gray-100">
                  {invites.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <span>
                        <span className="font-medium">{inv.kind === 'link' ? 'Join link' : inv.email}</span>
                        <span className="text-gray-500">
                          {' '}
                          · {roleLabel(inv.role)} · sent {timeAgo(inv.createdAt)}
                          {inv.invitedByName ? ` by ${inv.invitedByName}` : ''} · expires{' '}
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </span>
                      </span>
                      <button onClick={() => revoke(inv)} className={btn.danger}>
                        Cancel
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}

function InviteByEmail({ assignable, onDone }: { assignable: readonly AssignableRole[]; onDone: () => void }) {
  const api = useWorkspaceApi();
  const [text, setText] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ kind: 'error' | 'success'; message: string }>();
  const emails = extractEmails(text);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const found = extractEmails(await file.text());
    setText((t) => [...new Set([...extractEmails(t), ...found])].join('\n'));
    e.target.value = '';
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = inviteByEmailSchema.safeParse({ emails, role });
    if (!parsed.success) {
      setResult({ kind: 'error', message: parsed.error.issues[0]?.message ?? 'Check the email addresses' });
      return;
    }
    setPending(true);
    setResult(undefined);
    try {
      const res = await api<{ invited: unknown[]; skipped: { email: string }[] }>('/invitations', {
        method: 'POST',
        body: parsed.data,
      });
      const parts = [`Sent ${res.invited.length} invitation${res.invited.length === 1 ? '' : 's'}.`];
      if (res.skipped.length) parts.push(`Skipped ${res.skipped.map((s) => s.email).join(', ')} (already members).`);
      setResult({ kind: 'success', message: parts.join(' ') });
      setText('');
      onDone();
    } catch (err) {
      setResult({ kind: 'error', message: errorMessage(err, 'Could not send the invitations.') });
    } finally {
      setPending(false);
    }
  }

  return (
    <div id="invite" className="scroll-mt-24">
      <Card title="Invite by email" description="Paste one or more addresses, or upload a CSV. Each person gets a link that works for 7 days.">
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="sr-only">Email addresses</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={'sara@company.com, ali@company.com'}
              className={input}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-700">
              Role{' '}
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AssignableRole)}
                className="ms-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${btn.secondary} cursor-pointer`}>
              Upload CSV
              <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="sr-only" />
            </label>
            <button type="submit" disabled={pending || emails.length === 0} className={`${btn.primary} ms-auto`}>
              {pending ? 'Sending…' : emails.length > 1 ? `Invite ${emails.length} people` : 'Send invite'}
            </button>
          </div>
          {result && <Alert kind={result.kind}>{result.message}</Alert>}
        </form>
      </Card>
    </div>
  );
}

function InviteLink({ onDone }: { onDone: () => void }) {
  const api = useWorkspaceApi();
  const [role, setRole] = useState<'member' | 'manager' | 'guest'>('member');
  const [url, setUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setError(undefined);
    setCopied(false);
    try {
      const res = await api<InviteLinkResponse>('/invitations/link', { method: 'POST', body: { role } });
      setUrl(res.url);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not create a link.'));
    }
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
  }

  return (
    <Card
      title="Share a join link"
      description="Anyone with the link can join for 7 days. Post it in your team's WhatsApp group, and cancel it below when you're done."
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-700">
          Role{' '}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="ms-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="member">Member</option>
            <option value="manager">Manager</option>
            <option value="guest">Guest</option>
          </select>
        </label>
        <button onClick={create} className={btn.secondary}>
          Create link
        </button>
      </div>
      {url && (
        <div className="mt-3 flex gap-2">
          <input readOnly value={url} aria-label="Join link" className={`min-w-0 flex-1 ${input} bg-gray-50`} onFocus={(e) => e.target.select()} />
          <button onClick={copy} className={btn.primary}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {url && <p className="mt-2 text-xs text-gray-500">This is the only time the full link is shown.</p>}
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Card>
  );
}
