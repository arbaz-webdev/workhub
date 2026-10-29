'use client';

import { announcementSchema, hasRole, type AnnouncementDto, type AnnouncementReceiptsDto, type TeamDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/inbox/bits';
import { Modal } from '@/components/inbox/dialogs';
import { Alert, btn, input, PageHeader, timeAgo } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useInbox, useInboxEvents } from '@/lib/inbox';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

export default function AnnouncementsPage() {
  const { workspace, me } = useWorkspace();
  const api = useWorkspaceApi();
  const { refreshSummary } = useInbox();
  const canPost = hasRole(workspace.role, 'manager');
  const [list, setList] = useState<AnnouncementDto[]>();
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [editing, setEditing] = useState<AnnouncementDto | 'new' | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<AnnouncementDto | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<AnnouncementDto[]>('/announcements')
      .then(setList)
      .catch(() => setError('Could not load announcements.'));
  }, [api]);

  useEffect(() => {
    load();
    if (canPost) api<TeamDto[]>('/teams').then(setTeams).catch(() => {});
  }, [api, load, canPost]);

  useInboxEvents((s) => {
    if (s.type === 'announcement.changed' || s.type === 'reconnected') load();
  });

  // Opened from a notification: bring that one into view.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !list) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [list]);

  async function markRead(a: AnnouncementDto) {
    setList((l) => l?.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
    await api(`/announcements/${a.id}/read`, { method: 'POST' }).catch(() => load());
    refreshSummary();
  }

  async function remove(a: AnnouncementDto) {
    if (!confirm(`Delete “${a.title}”? Its read receipts go too.`)) return;
    try {
      await api(`/announcements/${a.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete it.');
    }
  }

  const mayChange = (a: AnnouncementDto) => a.author?.id === me.user.id || hasRole(workspace.role, 'admin');
  const unread = list?.filter((a) => !a.read).length ?? 0;

  return (
    <>
      <PageHeader
        title="Announcements"
        description={unread > 0 ? `${unread} for you to read.` : 'News for everyone, or for one team.'}
        action={
          canPost && (
            <button type="button" className={btn.primary} onClick={() => setEditing('new')}>
              New announcement
            </button>
          )
        }
      />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!list ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <p className="font-medium text-gray-800">No announcements yet</p>
          <p className="mt-1 text-sm text-gray-500">{canPost ? 'Post holiday notices, policy changes and news here. You’ll see who has read each one.' : 'When your managers post news, it shows up here.'}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {list.map((a) => (
            <li key={a.id} id={a.id} className={`scroll-mt-20 rounded-2xl border bg-white p-5 shadow-sm ${a.read ? 'border-gray-200' : 'border-brand-500 ring-1 ring-brand-100'}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {a.pinned && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Pinned</span>}
                <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">{a.team ? a.team.name : 'Everyone'}</span>
                {!a.read && <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">New</span>}
              </div>
              <h2 className="mt-2 text-lg font-semibold text-gray-900">{a.title}</h2>
              <p className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                <Avatar person={a.author} size="sm" />
                {a.author?.name ?? 'Former member'} · <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>{timeAgo(a.createdAt)}</time>
                {a.editedAt && ' · edited'}
              </p>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">{a.body}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!a.read && (
                  <button type="button" className={btn.primary} onClick={() => void markRead(a)}>
                    Mark as read
                  </button>
                )}
                {a.receipts && (
                  <button type="button" className={btn.ghost} onClick={() => setReceiptsFor(a)}>
                    Read by {a.receipts.read} of {a.receipts.total}
                  </button>
                )}
                {mayChange(a) && (
                  <span className="ms-auto flex gap-1">
                    <button type="button" className={btn.ghost} onClick={() => setEditing(a)}>
                      Edit
                    </button>
                    <button type="button" className={btn.danger} onClick={() => void remove(a)}>
                      Delete
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AnnouncementForm
          teams={teams}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {receiptsFor && <Receipts announcement={receiptsFor} onClose={() => setReceiptsFor(null)} />}
    </>
  );
}

function AnnouncementForm({ teams, existing, onClose, onSaved }: { teams: TeamDto[]; existing: AnnouncementDto | null; onClose: () => void; onSaved: () => void }) {
  const api = useWorkspaceApi();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [teamId, setTeamId] = useState(existing?.team?.id ?? '');
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = announcementSchema.safeParse({ title, body, teamId: teamId || null, pinned });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSaving(true);
    try {
      await api(existing ? `/announcements/${existing.id}` : '/announcements', { method: existing ? 'PATCH' : 'POST', body: parsed.data });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save it.');
      setSaving(false);
    }
  }

  return (
    <Modal label={existing ? 'Edit announcement' : 'New announcement'} onClose={onClose} wide>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <h2 className="text-base font-semibold">{existing ? 'Edit announcement' : 'New announcement'}</h2>
        {error && <Alert>{error}</Alert>}
        <label className="block text-sm">
          <span className="text-gray-700">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required autoFocus className={`mt-1 ${input}`} placeholder="e.g. Office closed on 5 February" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Message</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} maxLength={10_000} required className={`mt-1 ${input}`} />
        </label>
        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-sm">
            <span className="text-gray-700">For</span>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={`mt-1 ${input} !w-56`}>
              <option value="">Everyone</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} team
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Pin to the top
          </label>
        </div>
        {!existing && <p className="text-xs text-gray-500">Everyone it’s for gets a notification, and you’ll see who has read it.</p>}
        <div className="flex gap-2">
          <button type="submit" className={btn.primary} disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save' : 'Post'}
          </button>
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Receipts({ announcement, onClose }: { announcement: AnnouncementDto; onClose: () => void }) {
  const api = useWorkspaceApi();
  const [data, setData] = useState<AnnouncementReceiptsDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<AnnouncementReceiptsDto>(`/announcements/${announcement.id}/receipts`)
      .then(setData)
      .catch(() => setError('Could not load the read receipts.'));
  }, [api, announcement.id]);

  return (
    <Modal label="Read receipts" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div>
          <h2 className="text-base font-semibold">Who has read it</h2>
          <p className="truncate text-sm text-gray-500">{announcement.title}</p>
        </div>
        {error && <Alert>{error}</Alert>}
        {!data && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {data && (
          <>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Not yet ({data.unread.length})</h3>
              {data.unread.length === 0 ? (
                <p className="text-sm text-gray-500">Everyone has read it.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.unread.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-sm">
                      <Avatar person={p} size="sm" />
                      {p.name}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Read ({data.read.length})</h3>
              <ul className="space-y-1.5">
                {data.read.map((r) => (
                  <li key={r.person.id} className="flex items-center gap-2 text-sm">
                    <Avatar person={r.person} size="sm" />
                    <span className="flex-1">{r.person.name}</span>
                    <span className="text-xs text-gray-500">{new Date(r.readAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        <button type="button" className={`${btn.ghost} self-start`} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
