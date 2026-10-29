'use client';

import type { ChatMessageDto, PersonDto, TaskRefDto } from '@workhub/shared';
import { Fragment, useLayoutEffect, useRef } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { dayHeading } from './bits';
import type { Draft } from './composer';
import { MessageItem } from './message-item';

const GROUP_MS = 5 * 60_000;

export interface MessageActions {
  onReply?: (m: ChatMessageDto) => void;
  onEdit: (m: ChatMessageDto, d: Draft) => Promise<void>;
  onDelete: (m: ChatMessageDto) => void;
}

/**
 * Messages oldest first, grouped by day and by author, kept scrolled to the newest
 * unless the reader has scrolled up. Older pages load at the top without a jump.
 */
export function MessageList({
  messages,
  people,
  meId,
  canModerate,
  tasks,
  actions,
  hasMore,
  onLoadOlder,
  empty,
  highlight,
}: {
  messages: ChatMessageDto[];
  people: Map<string, PersonDto>;
  meId: string;
  canModerate: boolean;
  tasks: Map<string, TaskRefDto>;
  actions: MessageActions;
  hasMore?: boolean;
  onLoadOlder?: () => Promise<void>;
  empty?: React.ReactNode;
  /** A message to scroll to and flash (from a notification link). */
  highlight?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const olderFrom = useRef<{ height: number; top: number } | null>(null);
  const lastId = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (olderFrom.current) {
      // Older messages went in above: keep what the reader was looking at in place.
      el.scrollTop = el.scrollHeight - olderFrom.current.height + olderFrom.current.top;
      olderFrom.current = null;
      return;
    }
    const newest = messages.at(-1);
    const isNew = newest?.id !== lastId.current;
    lastId.current = newest?.id;
    if (isNew && (atBottom.current || newest?.author?.id === meId)) el.scrollTop = el.scrollHeight;
  }, [messages, meId]);

  useLayoutEffect(() => {
    if (!highlight) return;
    const target = document.getElementById(`m-${highlight}`);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.classList.add('ring-2', 'ring-amber-300');
    const timer = setTimeout(() => target.classList.remove('ring-2', 'ring-amber-300'), 2500);
    return () => clearTimeout(timer);
  }, [highlight, messages.length]);

  async function older() {
    const el = scroller.current;
    if (!el || !onLoadOlder) return;
    olderFrom.current = { height: el.scrollHeight, top: el.scrollTop };
    await onLoadOlder();
  }

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-3"
    >
      {hasMore && (
        <div className="mb-2 text-center">
          <button type="button" onClick={() => void older()} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
            {t('inbox.loadEarlier')}
          </button>
        </div>
      )}
      {messages.length === 0 && empty}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
        const grouped =
          !!prev && !newDay && !prev.deleted && prev.author?.id === m.author?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS && prev.replyCount === 0;
        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="my-3 flex items-center gap-3 text-xs font-medium text-gray-500" role="separator">
                <span className="h-px flex-1 bg-gray-200" />
                {dayHeading(m.createdAt, locale)}
                <span className="h-px flex-1 bg-gray-200" />
              </div>
            )}
            <MessageItem
              message={m}
              grouped={grouped}
              people={people}
              meId={meId}
              canModerate={canModerate}
              tasks={tasks}
              onReply={actions.onReply ? () => actions.onReply!(m) : undefined}
              onEdit={(d) => actions.onEdit(m, d)}
              onDelete={() => actions.onDelete(m)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
