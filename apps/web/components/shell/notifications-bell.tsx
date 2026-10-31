'use client';

import type { NotificationDto, NotificationsResponse } from '@workhub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, timeAgo } from '@/components/ui';
import { useInboxEvents } from '@/lib/inbox';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const POLL_MS = 60_000;

export function NotificationsBell() {
  const api = useWorkspaceApi();
  const { me } = useWorkspace();
  const router = useRouter();
  const [data, setData] = useState<NotificationsResponse>({ items: [], unreadCount: 0 });
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    api<NotificationsResponse>('/notifications').then(setData).catch(() => {});
  }, [api]);

  // Mentions, replies and announcements arrive live; everything else on the next poll.
  useInboxEvents((s) => {
    if (s.type === 'announcement.changed' || s.type === 'reconnected') load();
    else if (s.type === 'message.created' && s.message.author?.id !== me.user.id && (s.message.mentions.includes(me.user.id) || s.message.parentId)) load();
  });

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function openItem(n: NotificationDto) {
    if (!n.read) {
      await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
      load();
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
    load();
  }

  const label = data.unreadCount > 0 ? `Notifications, ${data.unreadCount} unread` : 'Notifications';

  return (
    <div className="relative">
      <button
        ref={button}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        className={`${btn.icon} relative bg-white shadow-sm`}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {data.unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
            {data.unreadCount > 9 ? '9+' : data.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panel}
          role="region"
          aria-label="Notifications"
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right animate-pop overflow-hidden rounded-3xl bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {data.unreadCount > 0 && (
              <button onClick={markAll} className="text-xs font-medium text-brand-700 hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          {data.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => openItem(n)}
                    className="flex w-full gap-3 px-4 py-3 text-left hover:bg-gray-50"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand-500'}`}
                    />
                    <span className="min-w-0">
                      <span className={`block text-sm ${n.read ? 'text-gray-600' : 'font-medium text-gray-900'}`}>
                        {n.title}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      {n.body && <span className="block truncate text-xs text-gray-500">{n.body}</span>}
                      <span className="block text-xs text-gray-400">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
