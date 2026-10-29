'use client';

import type { ChatMessageDto, PersonDto, TaskRefDto } from '@workhub/shared';
import { useState } from 'react';
import { Avatar, clockTime, fileSize, MessageText, TaskCard } from './bits';
import { Composer, type Draft } from './composer';

export function MessageItem({
  message,
  grouped,
  people,
  meId,
  canModerate,
  tasks,
  onReply,
  onEdit,
  onDelete,
}: {
  message: ChatMessageDto;
  /** Same author as the message above, moments later: no name or avatar. */
  grouped: boolean;
  people: Map<string, PersonDto>;
  meId: string;
  canModerate: boolean;
  tasks: Map<string, TaskRefDto>;
  onReply?: () => void;
  onEdit: (draft: Draft) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const mine = message.author?.id === meId;
  const mentionsMe = message.mentions.includes(meId);

  return (
    <article
      id={`m-${message.id}`}
      tabIndex={0}
      aria-label={`${message.author?.name ?? 'Someone'} at ${clockTime(message.createdAt)}`}
      className={`group relative flex gap-3 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${grouped ? 'py-0.5' : 'pt-2 pb-0.5'} ${mentionsMe ? 'bg-amber-50/70' : 'hover:bg-gray-50'}`}
    >
      <div className="w-9 shrink-0">
        {grouped ? (
          <span className="invisible block pt-0.5 text-right text-[10px] text-gray-400 group-hover:visible">{clockTime(message.createdAt)}</span>
        ) : (
          <Avatar person={message.author} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-900">{message.author?.name ?? 'Former member'}</span>
            <time dateTime={message.createdAt} className="text-xs text-gray-400" title={new Date(message.createdAt).toLocaleString()}>
              {clockTime(message.createdAt)}
            </time>
          </p>
        )}

        {message.deleted ? (
          <p className="text-sm italic text-gray-400">This message was deleted.</p>
        ) : editing ? (
          <div className="py-1">
            <Composer
              people={[...people.values()]}
              placeholder="Edit message"
              initial={{ body: message.body, mentions: message.mentions, taskIds: message.taskIds }}
              allowFiles={false}
              autoFocus
              onCancel={() => setEditing(false)}
              onSend={async (d) => {
                await onEdit(d);
                setEditing(false);
              }}
            />
          </div>
        ) : (
          <>
            {message.body && (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
                <MessageText body={message.body} mentions={message.mentions} people={people} meId={meId} />
                {message.editedAt && <span className="ml-1 text-xs text-gray-400">(edited)</span>}
              </p>
            )}
            {message.files.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-2">
                {message.files.map((f) =>
                  f.isImage ? (
                    <li key={f.id}>
                      <a href={`/api${f.url}`} target="_blank" rel="noopener" title={f.fileName}>
                        <img src={`/api${f.url}`} alt={f.fileName} loading="lazy" className="max-h-56 max-w-[min(20rem,100%)] rounded-lg border border-gray-200 object-cover" />
                      </a>
                    </li>
                  ) : (
                    <li key={f.id}>
                      <a href={`/api${f.url}`} download={f.fileName} className="flex max-w-72 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                        <svg aria-hidden="true" className="shrink-0 text-gray-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-gray-900">{f.fileName}</span>
                          <span className="block text-xs text-gray-500">{fileSize(f.sizeBytes)}</span>
                        </span>
                      </a>
                    </li>
                  ),
                )}
              </ul>
            )}
            {message.taskIds.length > 0 && (
              <div className="mt-1 space-y-1">
                {message.taskIds.map((id) => {
                  const t = tasks.get(id);
                  return t ? <TaskCard key={id} task={t} /> : null;
                })}
              </div>
            )}
          </>
        )}

        {onReply && message.replyCount > 0 && (
          <button type="button" onClick={onReply} className="mt-1 text-xs font-semibold text-brand-700 hover:underline">
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            {message.lastReplyAt && <span className="ml-1.5 font-normal text-gray-400">last {clockTime(message.lastReplyAt)}</span>}
          </button>
        )}
      </div>

      {!message.deleted && !editing && (
        // Shown on hover, or once the message is tapped or tabbed to (phones have no hover).
        <div className="invisible absolute -top-3 right-2 flex rounded-lg border border-gray-200 bg-white shadow-sm group-hover:visible group-focus-within:visible">
          {onReply && (
            <IconButton label="Reply in thread" onClick={onReply}>
              <path d="M9 17 4 12l5-5" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </IconButton>
          )}
          {mine && (
            <IconButton label="Edit message" onClick={() => setEditing(true)}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
            </IconButton>
          )}
          {(mine || canModerate) && (
            <IconButton
              label="Delete message"
              danger
              onClick={() => {
                if (confirm(mine ? 'Delete this message?' : `Delete ${message.author?.name ?? 'this person'}’s message?`)) onDelete();
              }}
            >
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </IconButton>
          )}
        </div>
      )}
    </article>
  );
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`grid h-7 w-7 place-items-center first:rounded-l-lg last:rounded-r-lg ${danger ? 'text-gray-500 hover:bg-red-50 hover:text-red-600' : 'text-gray-500 hover:bg-gray-100'}`}>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </button>
  );
}
