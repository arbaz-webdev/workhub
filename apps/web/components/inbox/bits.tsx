'use client';

import type { ChannelDto, PersonDto, Presence, TaskRefDto } from '@workhub/shared';
import Link from 'next/link';
import { Fragment } from 'react';
import { useInbox } from '@/lib/inbox';
import { localToday } from '@/lib/time';

const AVATAR_COLORS = ['bg-teal-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-emerald-600', 'bg-indigo-600', 'bg-orange-600'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

export function Avatar({ person, size = 'md' }: { person: PersonDto | null; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs';
  if (!person) return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-gray-300 font-semibold text-white ${cls}`}>?</span>;
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${AVATAR_COLORS[hash(person.id) % AVATAR_COLORS.length]} ${cls}`}>
      {initials(person.name)}
    </span>
  );
}

export const PRESENCE_LABELS: Record<Presence, string> = {
  in: 'Checked in',
  break: 'On a break',
  out: 'Checked out',
  leave: 'On leave',
  away: 'Not checked in',
};
const PRESENCE_DOT: Record<Presence, string> = {
  in: 'bg-emerald-500',
  break: 'bg-amber-400',
  out: 'bg-gray-300',
  leave: 'bg-violet-400',
  away: 'border border-gray-300 bg-white',
};

/** Where someone is today, from attendance. Nothing for guests, who don't see presence. */
export function PresenceDot({ userId, className = '' }: { userId: string; className?: string }) {
  const p = useInbox().presence.get(userId);
  if (!p) return null;
  return (
    <span title={PRESENCE_LABELS[p.presence]} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${PRESENCE_DOT[p.presence]} ${className}`}>
      <span className="sr-only">{PRESENCE_LABELS[p.presence]}</span>
    </span>
  );
}

/** "Ali", "Ali and Sara", "Ali, Sara and 2 others". */
export function peopleTitle(people: PersonDto[]) {
  const names = people.map((p) => p.name);
  if (names.length <= 2) return names.join(' and ') || 'Just you';
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} other${names.length === 3 ? '' : 's'}`;
}

export function channelTitle(c: ChannelDto) {
  return c.kind === 'dm' ? peopleTitle(c.people) : `#${c.name}`;
}

export function ChannelIcon({ channel }: { channel: ChannelDto }) {
  if (channel.kind === 'dm') {
    const first = channel.people[0];
    return (
      <span className="relative">
        <Avatar person={first ?? null} size="sm" />
        {channel.people.length === 1 && first && <PresenceDot userId={first.id} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white" />}
        {channel.people.length > 1 && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-gray-700 px-1 text-[9px] font-semibold leading-4 text-white ring-2 ring-white">{channel.people.length}</span>
        )}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center text-base text-gray-400">
      {channel.kind === 'private' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      ) : (
        '#'
      )}
    </span>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Message text with links and @mentions of the people it named. */
export function MessageText({ body, mentions, people, meId }: { body: string; mentions: string[]; people: Map<string, PersonDto>; meId: string }) {
  const named = mentions.map((id) => people.get(id)).filter((p): p is PersonDto => !!p);
  const mentionRe = named.length
    ? new RegExp(
        `(${named
          .map((p) => `@${escapeRe(p.name)}`)
          .sort((a, b) => b.length - a.length)
          .join('|')})`,
        'g',
      )
    : null;
  const byName = new Map(named.map((p) => [`@${p.name}`, p]));
  return (
    <>
      {body.split(URL_RE).map((part, i) => {
        if (i % 2 === 1) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 underline decoration-brand-100 hover:decoration-brand-700">
              {part}
            </a>
          );
        }
        if (!mentionRe) return <Fragment key={i}>{part}</Fragment>;
        return (
          <Fragment key={i}>
            {part.split(mentionRe).map((piece, j) => {
              const person = j % 2 === 1 ? byName.get(piece) : undefined;
              if (!person) return <Fragment key={j}>{piece}</Fragment>;
              return (
                <span key={j} className={`rounded px-0.5 font-medium ${person.id === meId ? 'bg-amber-100 text-amber-900' : 'bg-brand-50 text-brand-700'}`}>
                  {piece}
                </span>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}

const PRIORITY_COLORS: Record<TaskRefDto['priority'], string> = {
  none: '',
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-sky-100 text-sky-800',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-700',
};

/** A task mentioned in chat, as it is right now. */
export function TaskCard({ task }: { task: TaskRefDto }) {
  const overdue = !task.completed && task.dueDate && task.dueDate < localToday();
  return (
    <Link
      href={`/app/projects/${task.projectId}?task=${task.id}`}
      className="flex max-w-md items-start gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 hover:border-brand-500 hover:bg-brand-50/40"
    >
      <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${task.completed ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300'}`}>
        {task.completed && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
            <path d="m5 12 5 5L20 7" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${task.completed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{task.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          <span className="truncate">{task.projectName}</span>
          <span aria-hidden="true">·</span>
          <span>{task.columnName}</span>
          {task.priority !== 'none' && <span className={`rounded px-1.5 py-px font-medium capitalize ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>}
          {task.dueDate && (
            <span className={overdue ? 'font-medium text-red-600' : ''}>
              Due {new Date(`${task.dueDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
          )}
        </span>
      </span>
      {task.assignees.length > 0 && (
        <span className="flex -space-x-1.5">
          {task.assignees.slice(0, 3).map((a) => (
            <span key={a.id} title={a.name} className="rounded-full ring-2 ring-white">
              <Avatar person={a} size="sm" />
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function dayHeading(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) });
}
