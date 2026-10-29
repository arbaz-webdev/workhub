'use client';

import { createChannelSchema, hasRole, MAX_DM_PEOPLE, type ChannelDto, type PersonDto, type Role } from '@workhub/shared';
import { useEffect, useState } from 'react';
import { Alert, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspaceApi } from '@/lib/workspace';
import { Avatar, channelTitle, PresenceDot } from './bits';

export function Modal({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-gray-900/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-[min(40rem,calc(100dvh-2rem))] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${wide ? 'max-w-lg' : 'max-w-md'}`}
      >
        {children}
      </div>
    </div>
  );
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback;
}

/** Search and tick people. */
function PeoplePicker({ people, chosen, onChange, max, exclude = [] }: { people: PersonDto[]; chosen: string[]; onChange: (ids: string[]) => void; max?: number; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const list = people.filter((p) => !exclude.includes(p.id) && (p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className={input} autoFocus />
      <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200">
        {list.length === 0 && <li className="px-3 py-4 text-center text-sm text-gray-500">No one matches.</li>}
        {list.map((p) => {
          const on = chosen.includes(p.id);
          const full = !on && max !== undefined && chosen.length >= max;
          return (
            <li key={p.id} className="border-b border-gray-100 last:border-0">
              <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${full ? 'opacity-50' : 'hover:bg-gray-50'}`}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => onChange(on ? chosen.filter((id) => id !== p.id) : [...chosen, p.id])} className="h-4 w-4 accent-brand-600" />
                <Avatar person={p} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="truncate">{p.name}</span>
                    <PresenceDot userId={p.id} />
                  </span>
                  <span className="block truncate text-xs text-gray-500">{p.email}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NewChannelDialog({ people, meId, onClose, onCreated }: { people: PersonDto[]; meId: string; onClose: () => void; onCreated: (c: ChannelDto) => void }) {
  const api = useWorkspaceApi();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [secret, setSecret] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createChannelSchema.safeParse({ name, topic: topic || null, private: secret, memberIds: members });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setSaving(true);
    try {
      onCreated(await api<ChannelDto>('/chat/channels', { method: 'POST', body: parsed.data }));
    } catch (err) {
      setError(errorText(err, 'Could not create the channel.'));
      setSaving(false);
    }
  }

  return (
    <Modal label="New channel" onClose={onClose}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div>
          <h2 className="text-base font-semibold">New channel</h2>
          <p className="text-sm text-gray-500">A place for a team, a client or a topic.</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <label className="block text-sm">
          <span className="text-gray-700">Name</span>
          <span className="mt-1 flex items-center rounded-lg border border-gray-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
            <span className="ps-3 text-gray-400">#</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sales" maxLength={80} required autoFocus className="w-full bg-transparent px-1.5 py-2 text-sm outline-none" />
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Topic (optional)</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={250} className={`mt-1 ${input}`} />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
          <span>
            <span className="font-medium text-gray-800">Private</span>
            <span className="block text-gray-500">Only the people you add can find it or read it. Not even admins can see inside.</span>
          </span>
        </label>
        {secret && (
          <div className="flex h-64 flex-col">
            <p className="mb-2 text-sm text-gray-700">Add people</p>
            <PeoplePicker people={people} chosen={members} onChange={setMembers} exclude={[meId]} />
          </div>
        )}
        <div className="flex gap-2">
          <button type="submit" className={btn.primary} disabled={saving}>
            {saving ? 'Creating…' : 'Create channel'}
          </button>
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function NewDmDialog({ people, meId, onClose, onOpened }: { people: PersonDto[]; meId: string; onClose: () => void; onOpened: (c: ChannelDto) => void }) {
  const api = useWorkspaceApi();
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function start() {
    setSaving(true);
    try {
      onOpened(await api<ChannelDto>('/chat/dm', { method: 'POST', body: { userIds: chosen } }));
    } catch (err) {
      setError(errorText(err, 'Could not start the conversation.'));
      setSaving(false);
    }
  }

  return (
    <Modal label="New message" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
        <div>
          <h2 className="text-base font-semibold">New message</h2>
          <p className="text-sm text-gray-500">Choose one person, or up to {MAX_DM_PEOPLE - 1} for a group.</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex h-80 flex-col">
          <PeoplePicker people={people} chosen={chosen} onChange={setChosen} max={MAX_DM_PEOPLE - 1} exclude={[meId]} />
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn.primary} disabled={saving || chosen.length === 0} onClick={start}>
            {saving ? 'Opening…' : chosen.length > 1 ? `Message ${chosen.length} people` : 'Message'}
          </button>
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function BrowseChannelsDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (c: ChannelDto) => void }) {
  const api = useWorkspaceApi();
  const [list, setList] = useState<ChannelDto[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<ChannelDto[]>('/chat/channels/browse')
      .then(setList)
      .catch(() => setError('Could not load channels.'));
  }, [api]);

  async function join(c: ChannelDto) {
    try {
      onOpen(await api<ChannelDto>(`/chat/channels/${c.id}/join`, { method: 'POST' }));
    } catch (err) {
      setError(errorText(err, 'Could not join the channel.'));
    }
  }

  return (
    <Modal label="Browse channels" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">Channels</h2>
        {error && <Alert>{error}</Alert>}
        <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200">
          {!list && <li className="px-3 py-4 text-sm text-gray-500">Loading…</li>}
          {list?.length === 0 && <li className="px-3 py-4 text-sm text-gray-500">No public channels yet.</li>}
          {list?.map((c) => (
            <li key={c.id} className="flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{channelTitle(c)}</span>
                <span className="block truncate text-xs text-gray-500">
                  {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
                  {c.topic && ` · ${c.topic}`}
                </span>
              </span>
              <button type="button" className={btn.ghost} onClick={() => onOpen(c)}>
                View
              </button>
              {!c.joined && (
                <button type="button" className={`${btn.primary} !px-3 !py-1.5`} onClick={() => join(c)}>
                  Join
                </button>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className={`${btn.ghost} self-start`} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function ChannelDetailsDialog({
  channel,
  people,
  meId,
  role,
  onClose,
  onChanged,
  onLeft,
}: {
  channel: ChannelDto;
  people: PersonDto[];
  meId: string;
  role: Role;
  onClose: () => void;
  onChanged: (c: ChannelDto) => void;
  onLeft: () => void;
}) {
  const api = useWorkspaceApi();
  const [members, setMembers] = useState<PersonDto[]>();
  const [name, setName] = useState(channel.name ?? '');
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [adding, setAdding] = useState<string[] | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const isDm = channel.kind === 'dm';
  const canManage = !isDm && !channel.isDefault && (channel.createdById === meId || hasRole(role, 'admin'));
  const canRename = !isDm && channel.joined && (!channel.isDefault || hasRole(role, 'admin'));

  useEffect(() => {
    api<PersonDto[]>(`/chat/channels/${channel.id}/members`)
      .then(setMembers)
      .catch(() => setError('Could not load the members.'));
  }, [api, channel.id]);

  async function run(fn: () => Promise<void>, done?: string) {
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (err) {
      setError(errorText(err, 'That didn’t work. Please try again.'));
    }
  }

  const reloadMembers = async () => setMembers(await api<PersonDto[]>(`/chat/channels/${channel.id}/members`));

  return (
    <Modal label={`${channelTitle(channel)} details`} onClose={onClose} wide>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div>
          <h2 className="text-base font-semibold">{channelTitle(channel)}</h2>
          <p className="text-sm text-gray-500">
            {isDm ? 'Direct message. Only the people in it can read it.' : channel.kind === 'private' ? 'Private channel. Only its members can find or read it.' : 'Public channel. Anyone in the workspace can read and join it.'}
          </p>
        </div>
        <div aria-live="polite" className="space-y-2">
          {error && <Alert>{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
        </div>

        {canRename && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => onChanged(await api<ChannelDto>(`/chat/channels/${channel.id}`, { method: 'PATCH', body: { name, topic: topic || null } })), 'Saved.');
            }}
          >
            <label className="block text-sm">
              <span className="text-gray-700">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={`mt-1 ${input}`} />
            </label>
            <label className="block text-sm">
              <span className="text-gray-700">Topic</span>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={250} className={`mt-1 ${input}`} />
            </label>
            <button type="submit" className={btn.secondary}>
              Save
            </button>
          </form>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Members {members && <span className="font-normal text-gray-500">({members.length})</span>}
            </h3>
            {!isDm && channel.joined && adding === null && hasRole(role, 'member') && (
              <button type="button" className={btn.ghost} onClick={() => setAdding([])}>
                Add people
              </button>
            )}
          </div>
          {adding !== null ? (
            <div className="flex h-72 flex-col gap-2">
              <PeoplePicker people={people} chosen={adding} onChange={setAdding} exclude={members?.map((m) => m.id) ?? []} />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={btn.primary}
                  disabled={adding.length === 0}
                  onClick={() =>
                    void run(async () => {
                      onChanged(await api<ChannelDto>(`/chat/channels/${channel.id}/members`, { method: 'POST', body: { userIds: adding } }));
                      setAdding(null);
                      await reloadMembers();
                    }, 'Added.')
                  }
                >
                  Add {adding.length > 0 ? adding.length : ''}
                </button>
                <button type="button" className={btn.ghost} onClick={() => setAdding(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ul className="max-h-60 overflow-y-auto rounded-lg border border-gray-200">
              {members?.map((m) => (
                <li key={m.id} className="flex items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-0">
                  <Avatar person={m} size="sm" />
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}
                    {m.id === meId && <span className="text-gray-400"> (you)</span>}
                  </span>
                  <PresenceDot userId={m.id} />
                  {canManage && m.id !== meId && (
                    <button
                      type="button"
                      className="text-xs font-medium text-red-600 hover:underline"
                      onClick={() =>
                        void run(async () => {
                          await api(`/chat/channels/${channel.id}/members/${m.id}`, { method: 'DELETE' });
                          await reloadMembers();
                        }, `${m.name} was removed.`)
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
          {channel.joined && (
            <button
              type="button"
              className={btn.secondary}
              onClick={() => void run(async () => onChanged(await api<ChannelDto>(`/chat/channels/${channel.id}/mute`, { method: 'POST', body: { muted: !channel.muted } })))}
            >
              {channel.muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          {!isDm && !channel.isDefault && channel.joined && (
            <button
              type="button"
              className={btn.danger}
              onClick={() =>
                void run(async () => {
                  await api(`/chat/channels/${channel.id}/leave`, { method: 'POST' });
                  onLeft();
                })
              }
            >
              Leave channel
            </button>
          )}
          {canManage && (
            <button
              type="button"
              className={btn.danger}
              onClick={() => {
                if (!confirm(`Archive ${channelTitle(channel)}? It becomes read-only and leaves everyone’s list.`)) return;
                void run(async () => {
                  await api(`/chat/channels/${channel.id}/archive`, { method: 'POST' });
                  onLeft();
                });
              }}
            >
              Archive
            </button>
          )}
          <button type="button" className={`${btn.ghost} ms-auto`} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
