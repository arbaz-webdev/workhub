'use client';

import { hasRole, type ChannelDto, type ChatMessageDto, type MessagePageDto, type PersonDto, type TaskRefDto, type ThreadDto } from '@workhub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChannelIcon, channelTitle } from '@/components/inbox/bits';
import { Composer, type Draft } from '@/components/inbox/composer';
import { BrowseChannelsDialog, ChannelDetailsDialog, NewChannelDialog, NewDmDialog } from '@/components/inbox/dialogs';
import { MessageList, type MessageActions } from '@/components/inbox/message-list';
import { Alert, btn } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useInbox, useInboxEvents } from '@/lib/inbox';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

export default function InboxPage() {
  const t = useT();
  return (
    <Suspense fallback={<p className="p-4 text-sm text-gray-500">{t('common.loading')}</p>}>
      <Inbox />
    </Suspense>
  );
}

type Dialog = 'channel' | 'dm' | 'browse' | 'details' | null;

const sortChannels = (list: ChannelDto[]) =>
  [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));

function Inbox() {
  const { workspace, me } = useWorkspace();
  const api = useWorkspaceApi();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { presence, live, refreshSummary } = useInbox();
  const staff = hasRole(workspace.role, 'member');
  const meId = me.user.id;
  const openId = params.get('c');
  const threadId = params.get('thread');

  const [channels, setChannels] = useState<ChannelDto[]>();
  const [current, setCurrent] = useState<ChannelDto | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [thread, setThread] = useState<ThreadDto | null>(null);
  const [everyone, setEveryone] = useState<PersonDto[]>([]);
  const [members, setMembers] = useState<PersonDto[]>([]);
  const [tasks, setTasks] = useState(new Map<string, TaskRefDto>());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string>();
  const requestedTasks = useRef(new Set<string>());
  const openRef = useRef(openId);
  openRef.current = openId;

  const go = useCallback(
    (c: string | null, thread?: string | null) => {
      const q = new URLSearchParams();
      if (c) q.set('c', c);
      if (thread) q.set('thread', thread);
      router.push(`/app/inbox${q.size ? `?${q}` : ''}`, { scroll: false });
    },
    [router],
  );

  const loadChannels = useCallback(async () => {
    try {
      setChannels(sortChannels(await api<ChannelDto[]>('/chat/channels')));
    } catch {
      setError(t('inbox.loadChannelsError'));
    }
  }, [api, t]);

  useEffect(() => {
    void loadChannels();
    if (staff) api<PersonDto[]>('/chat/people').then(setEveryone).catch(() => {});
  }, [api, loadChannels, staff]);

  // On a wide screen, open #general rather than an empty pane.
  useEffect(() => {
    if (!openId && channels?.length && window.matchMedia('(min-width: 768px)').matches) {
      router.replace(`/app/inbox?c=${channels[0]!.id}`, { scroll: false });
    }
  }, [openId, channels, router]);

  const markRead = useCallback(
    (id: string) => {
      if (document.visibilityState !== 'visible') return;
      setChannels((list) => list?.map((c) => (c.id === id ? { ...c, unread: 0, mentions: 0 } : c)));
      api(`/chat/channels/${id}/read`, { method: 'POST' })
        .then(refreshSummary)
        .catch(() => {});
    },
    [api, refreshSummary],
  );

  const loadConversation = useCallback(
    async (id: string) => {
      setLoadingMessages(true);
      setError(undefined);
      try {
        const [c, page] = await Promise.all([api<ChannelDto>(`/chat/channels/${id}`), api<MessagePageDto>(`/chat/channels/${id}/messages`)]);
        if (openRef.current !== id) return;
        setCurrent(c);
        setMessages(page.messages);
        setHasMore(page.hasMore);
        if (c.joined) markRead(id);
        // Mentions in private conversations are limited to the people in them.
        if (c.kind !== 'public' || !staff) setMembers(await api<PersonDto[]>(`/chat/channels/${id}/members`));
        else setMembers([]);
      } catch (err) {
        if (openRef.current !== id) return;
        setCurrent(null);
        setMessages([]);
        setError(err instanceof ApiError && err.status === 404 ? t('inbox.notAvailable') : t('inbox.loadConversationError'));
      } finally {
        setLoadingMessages(false);
      }
    },
    [api, markRead, staff, t],
  );

  useEffect(() => {
    // Task cards are fetched fresh for each conversation, so they show the task as it is now.
    requestedTasks.current = new Set();
    setTasks(new Map());
    setThread(null);
    if (openId) void loadConversation(openId);
    else setCurrent(null);
  }, [openId, loadConversation]);

  const loadThread = useCallback(
    async (id: string) => {
      try {
        setThread(await api<ThreadDto>(`/chat/messages/${id}/thread`));
      } catch {
        setThread(null);
      }
    },
    [api],
  );

  useEffect(() => {
    if (threadId) void loadThread(threadId);
    else setThread(null);
  }, [threadId, loadThread]);

  // Fetch cards for tasks we haven't asked about yet.
  useEffect(() => {
    const ids = [...new Set([...messages, ...(thread ? [thread.root, ...thread.replies] : [])].flatMap((m) => m.taskIds))].filter((id) => !requestedTasks.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => requestedTasks.current.add(id));
    for (let i = 0; i < ids.length; i += 20) {
      api<TaskRefDto[]>(`/chat/task-refs?ids=${ids.slice(i, i + 20).join(',')}`)
        .then((refs) => setTasks((prev) => new Map([...prev, ...refs.map((r) => [r.id, r] as const)])))
        .catch(() => {});
    }
  }, [api, messages, thread]);

  // Coming back to the tab reads what arrived meanwhile.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && current?.joined && channels?.find((c) => c.id === current.id)?.unread) markRead(current.id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [current, channels, markRead]);

  const replace = (m: ChatMessageDto) => {
    setMessages((list) => list.map((x) => (x.id === m.id ? m : x)));
    setThread((th) => (th ? { root: th.root.id === m.id ? m : th.root, replies: th.replies.map((r) => (r.id === m.id ? m : r)) } : th));
  };

  const received = (m: ChatMessageDto) => {
    if (m.channelId === openRef.current) {
      if (!m.parentId) setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      setThread((th) => (th && m.parentId === th.root.id && !th.replies.some((r) => r.id === m.id) ? { ...th, replies: [...th.replies, m] } : th));
    }
  };

  useInboxEvents((s) => {
    switch (s.type) {
      case 'message.created': {
        const m = s.message;
        received(m);
        const open = m.channelId === openRef.current;
        if (open && m.author?.id !== meId && current?.joined) markRead(m.channelId);
        setChannels((list) => {
          if (!list) return list;
          if (!list.some((c) => c.id === m.channelId)) {
            void loadChannels();
            return list;
          }
          return sortChannels(
            list.map((c) => {
              if (c.id !== m.channelId) return c;
              const theirs = m.author?.id !== meId && !open;
              return {
                ...c,
                lastMessageAt: m.parentId ? c.lastMessageAt : m.createdAt,
                unread: c.unread + (theirs && !m.parentId ? 1 : 0),
                mentions: c.mentions + (theirs && m.mentions.includes(meId) ? 1 : 0),
              };
            }),
          );
        });
        break;
      }
      case 'message.updated':
        replace(s.message);
        break;
      case 'channel.changed':
        void loadChannels();
        if (s.channelId === openRef.current) void loadConversation(s.channelId);
        break;
      case 'channel.read':
        setChannels((list) => list?.map((c) => (c.id === s.channelId ? { ...c, unread: 0, mentions: 0 } : c)));
        break;
      case 'reconnected':
        void loadChannels();
        if (openRef.current) void loadConversation(openRef.current);
        if (threadId) void loadThread(threadId);
        break;
    }
  });

  async function send(channelId: string, d: Draft, parentId?: string) {
    const form = new FormData();
    form.set('body', d.body);
    if (parentId) form.set('parentId', parentId);
    form.set('mentions', JSON.stringify(d.mentions));
    form.set('taskIds', JSON.stringify(d.taskIds));
    for (const f of d.files) form.append('files', f);
    try {
      received(await api<ChatMessageDto>(`/chat/channels/${channelId}/messages`, { method: 'POST', body: form }));
    } catch (err) {
      throw new Error(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('inbox.sendFailed'));
    }
  }

  const actions: MessageActions = {
    onEdit: async (m, d) => {
      try {
        replace(await api<ChatMessageDto>(`/chat/messages/${m.id}`, { method: 'PATCH', body: { body: d.body, mentions: d.mentions, taskIds: d.taskIds } }));
      } catch (err) {
        throw new Error(err instanceof ApiError ? err.message : t('inbox.editFailed'));
      }
    },
    onDelete: (m) => {
      api(`/chat/messages/${m.id}`, { method: 'DELETE' }).catch((err) => setError(err instanceof ApiError ? err.message : t('inbox.deleteFailed')));
    },
  };

  async function loadOlder() {
    if (!current || messages.length === 0) return;
    const page = await api<MessagePageDto>(`/chat/channels/${current.id}/messages?before=${encodeURIComponent(messages[0]!.createdAt)}`);
    setMessages((list) => [...page.messages.filter((m) => !list.some((x) => x.id === m.id)), ...list]);
    setHasMore(page.hasMore);
  }

  async function join() {
    if (!current) return;
    try {
      setCurrent(await api<ChannelDto>(`/chat/channels/${current.id}/join`, { method: 'POST' }));
      await loadChannels();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('inbox.joinFailed'));
    }
  }

  // Everyone we may need a name for: the directory, the conversation's members and authors.
  const people = useMemo(() => {
    const map = new Map<string, PersonDto>();
    for (const p of [...everyone, ...members, ...(current?.people ?? [])]) map.set(p.id, p);
    for (const m of [...messages, ...(thread?.replies ?? [])]) if (m.author) map.set(m.author.id, m.author);
    return map;
  }, [everyone, members, current, messages, thread]);
  const mentionable = current?.kind === 'public' && staff ? everyone : members;
  const canModerate = !!current && current.kind !== 'dm' && hasRole(workspace.role, 'admin');
  const channelsList = channels?.filter((c) => c.kind !== 'dm') ?? [];
  const dms = channels?.filter((c) => c.kind === 'dm') ?? [];
  const solo = current?.kind === 'dm' && current.people.length === 1 ? current.people[0]! : null;
  const soloPresence = solo ? presence.get(solo.id) : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.6rem)] min-h-[26rem] overflow-hidden border-gray-200 bg-white sm:h-[calc(100dvh-5.6rem)] sm:rounded-2xl sm:border">
      {/* Conversations */}
      <nav aria-label={t('inbox.conversations')} className={`${openId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-e border-gray-200 md:w-64 lg:w-72`}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h1 className="flex items-center gap-2 text-base font-semibold">
            {t('nav.inbox')}
            <span title={live ? t('inbox.live') : t('inbox.reconnectingTitle')} className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-gray-300'}`}>
              <span className="sr-only">{live ? t('inbox.live') : t('inbox.reconnecting')}</span>
            </span>
          </h1>
          {staff && (
            <button type="button" onClick={() => setDialog('dm')} className={`${btn.primary} !px-3 !py-1.5`}>
              {t('inbox.newMessage')}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!channels && <p className="px-2 py-3 text-sm text-gray-500">{t('common.loading')}</p>}
          {channels && (
            <>
              <Section title={t('inbox.channels')} action={staff ? { label: t('inbox.browseOrCreate'), onClick: () => setDialog('browse') } : undefined}>
                {channelsList.map((c) => (
                  <ChannelRow key={c.id} channel={c} active={c.id === openId} onClick={() => go(c.id)} />
                ))}
                {staff && (
                  <li>
                    <button type="button" onClick={() => setDialog('channel')} className="w-full rounded-lg px-2 py-1.5 text-start text-sm text-gray-500 hover:bg-gray-50">
                      {t('inbox.addChannel')}
                    </button>
                  </li>
                )}
              </Section>
              <Section title={t('inbox.directMessages')} action={staff ? { label: t('inbox.newMessage'), onClick: () => setDialog('dm') } : undefined}>
                {dms.length === 0 && <li className="px-2 py-1.5 text-sm text-gray-500">{t('inbox.noDms')}</li>}
                {dms.map((c) => (
                  <ChannelRow key={c.id} channel={c} active={c.id === openId} onClick={() => go(c.id)} />
                ))}
              </Section>
            </>
          )}
        </div>
      </nav>

      {/* The open conversation */}
      <section aria-label={current ? channelTitle(current, locale) : t('inbox.conversation')} className={`${openId && !threadId ? 'flex' : 'hidden'} ${threadId ? 'xl:flex' : 'md:flex'} min-w-0 flex-1 flex-col`}>
        {openId ? (
          <>
            <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
              <button type="button" aria-label={t('inbox.back')} onClick={() => go(null)} className="grid h-8 w-8 place-items-center rounded-lg text-gray-600 hover:bg-gray-100 md:hidden">
                <svg aria-hidden="true" className="rtl:rotate-180" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              {current && (
                <button type="button" onClick={() => setDialog('details')} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-start hover:bg-gray-50">
                  <ChannelIcon channel={current} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {channelTitle(current, locale)}
                      {current.muted && <span className="ms-1.5 text-xs font-normal text-gray-400">{t('inbox.muted')}</span>}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {soloPresence
                        ? t(`presence.${soloPresence.presence}`)
                        : current.topic ||
                          (current.kind === 'dm' ? t('inbox.directMessage') : current.memberCount === 1 ? t('inbox.members.one') : t('inbox.members.many', { n: current.memberCount }))}
                    </span>
                  </span>
                </button>
              )}
            </header>
            {error && (
              <div className="px-3 pt-3">
                <Alert>{error}</Alert>
              </div>
            )}
            {current && (
              <>
                <MessageList
                  messages={messages}
                  people={people}
                  meId={meId}
                  canModerate={canModerate}
                  tasks={tasks}
                  hasMore={hasMore}
                  onLoadOlder={loadOlder}
                  actions={{ ...actions, onReply: (m) => go(current.id, m.id) }}
                  empty={
                    !loadingMessages && (
                      <p className="px-4 py-10 text-center text-sm text-gray-500">
                        {t(current.kind === 'dm' ? 'inbox.startDm' : 'inbox.startChannel', { name: channelTitle(current, locale) })}
                      </p>
                    )
                  }
                />
                <div className="border-t border-gray-100 p-3">
                  {current.joined ? (
                    <Composer key={current.id} people={mentionable.filter((p) => p.id !== meId)} placeholder={t('inbox.messagePlaceholder', { name: channelTitle(current, locale) })} onSend={(d) => send(current.id, d)} autoFocus />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-3 text-sm">
                      <span className="text-gray-600">{t('inbox.viewing', { name: channelTitle(current, locale) })}</span>
                      <button type="button" className={btn.primary} onClick={join}>
                        {t('inbox.joinChannel')}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-gray-500">{t('inbox.choose')}</div>
        )}
      </section>

      {/* A thread */}
      {threadId && current && (
        <aside aria-label={t('inbox.thread')} className="flex min-w-0 flex-1 flex-col border-s border-gray-200 xl:w-96 xl:flex-none">
          <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold">
              {t('inbox.thread')} <span className="font-normal text-gray-500">{t('inbox.threadIn', { name: channelTitle(current, locale) })}</span>
            </h2>
            <button type="button" aria-label={t('inbox.closeThread')} onClick={() => go(current.id)} className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100">
              ×
            </button>
          </header>
          {!thread ? (
            <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p>
          ) : (
            <>
              <MessageList
                messages={[thread.root, ...thread.replies]}
                people={people}
                meId={meId}
                canModerate={canModerate}
                tasks={tasks}
                actions={actions}
                highlight={threadId !== thread.root.id ? threadId : null}
              />
              <div className="border-t border-gray-100 p-3">
                {current.joined && !thread.root.deleted ? (
                  <Composer key={thread.root.id} people={mentionable.filter((p) => p.id !== meId)} placeholder={t('inbox.replyPlaceholder')} onSend={(d) => send(current.id, d, thread.root.id)} autoFocus />
                ) : (
                  <p className="text-sm text-gray-500">{thread.root.deleted ? t('inbox.rootDeleted') : t('inbox.joinToReply')}</p>
                )}
              </div>
            </>
          )}
        </aside>
      )}

      {dialog === 'channel' && (
        <NewChannelDialog
          people={everyone}
          meId={meId}
          onClose={() => setDialog(null)}
          onCreated={(c) => {
            setDialog(null);
            void loadChannels();
            go(c.id);
          }}
        />
      )}
      {dialog === 'dm' && (
        <NewDmDialog
          people={everyone}
          meId={meId}
          onClose={() => setDialog(null)}
          onOpened={(c) => {
            setDialog(null);
            void loadChannels();
            go(c.id);
          }}
        />
      )}
      {dialog === 'browse' && (
        <BrowseChannelsDialog
          onClose={() => setDialog(null)}
          onOpen={(c) => {
            setDialog(null);
            void loadChannels();
            go(c.id);
          }}
        />
      )}
      {dialog === 'details' && current && (
        <ChannelDetailsDialog
          channel={current}
          people={everyone}
          meId={meId}
          role={workspace.role}
          onClose={() => setDialog(null)}
          onChanged={(c) => {
            setCurrent(c);
            void loadChannels();
          }}
          onLeft={() => {
            setDialog(null);
            void loadChannels();
            go(null);
          }}
        />
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-2 pb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
        {action && (
          <button type="button" onClick={action.onClick} aria-label={action.label} title={action.label} className="grid h-6 w-6 place-items-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            +
          </button>
        )}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function ChannelRow({ channel, active, onClick }: { channel: ChannelDto; active: boolean; onClick: () => void }) {
  const t = useT();
  const locale = useLocale();
  const unread = channel.unread > 0 && !channel.muted;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm ${active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-50'}`}
      >
        <ChannelIcon channel={channel} />
        <span className={`min-w-0 flex-1 truncate ${unread || channel.mentions ? 'font-semibold text-gray-900' : ''} ${channel.muted ? 'text-gray-400' : ''}`}>
          {channel.kind === 'dm' ? channelTitle(channel, locale) : channel.name}
        </span>
        {channel.mentions > 0 ? (
          <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white">
            @{channel.mentions}
            <span className="sr-only">{t('inbox.mentionsSr')}</span>
          </span>
        ) : (
          unread && (
            <span className="rounded-full bg-gray-200 px-1.5 text-[11px] font-semibold leading-5 text-gray-700">
              {channel.unread > 99 ? '99+' : channel.unread}
              <span className="sr-only">{t('nav.unread')}</span>
            </span>
          )
        )}
      </button>
    </li>
  );
}
