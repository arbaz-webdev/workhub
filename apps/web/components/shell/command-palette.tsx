'use client';

import { hasRole, type MemberDto, type ProjectSummaryDto, type TeamDto } from '@workhub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';
import { NAV } from './nav';

interface Command {
  id: string;
  group: 'Go to' | 'Actions' | 'Projects' | 'Teams' | 'People' | 'Switch workspace';
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

/** Ctrl+K (⌘K on Mac) palette: jump to pages, people and teams, or run an action. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const api = useWorkspaceApi();
  const { me, workspace, switchTo } = useWorkspace();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [people, setPeople] = useState<MemberDto[]>([]);
  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Fresh data each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    api<TeamDto[]>('/teams').then(setTeams).catch(() => {});
    api<MemberDto[]>('/members').then(setPeople).catch(() => {});
    api<ProjectSummaryDto[]>('/projects').then(setProjects).catch(() => {});
  }, [open, api]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const go = useCallback(
    (href: string) => () => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const t = useT();
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = NAV.filter((n) => !n.minRole || hasRole(workspace.role, n.minRole)).map((n) => ({
      id: `nav:${n.href}`,
      group: 'Go to',
      label: t(n.labelKey),
      // English words still find it.
      keywords: `${n.label} ${n.keywords ?? ''}`,
      run: go(n.href),
    }));
    if (hasRole(workspace.role, 'admin')) {
      list.push({ id: 'act:invite', group: 'Actions', label: 'Invite people', keywords: 'add teammate email link', run: go('/app/people#invite') });
    }
    if (hasRole(workspace.role, 'manager')) {
      list.push({ id: 'act:team', group: 'Actions', label: 'Create a team', keywords: 'new department', run: go('/app/teams') });
    }
    for (const p of projects) {
      list.push({ id: `project:${p.id}`, group: 'Projects', label: p.name, hint: p.client?.name, keywords: p.client?.name, run: go(`/app/projects/${p.id}`) });
    }
    for (const t of teams) list.push({ id: `team:${t.id}`, group: 'Teams', label: t.name, run: go('/app/teams') });
    for (const p of people) {
      list.push({ id: `person:${p.userId}`, group: 'People', label: p.name, hint: p.email, keywords: p.email, run: go('/app/people') });
    }
    for (const w of me.workspaces) {
      if (w.id === workspace.id) continue;
      list.push({
        id: `ws:${w.id}`,
        group: 'Switch workspace',
        label: w.name,
        run: () => {
          close();
          switchTo(w);
          router.push('/app');
        },
      });
    }
    return list;
  }, [workspace, me.workspaces, projects, teams, people, go, close, switchTo, router]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => c.group === 'Go to' || c.group === 'Actions');
    return commands.filter((c) => `${c.label} ${c.keywords ?? ''} ${c.hint ?? ''}`.toLowerCase().includes(q)).slice(0, 30);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/30 px-4 pt-[12vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Search pages, people, teams…"
          className="w-full border-b border-gray-100 px-4 py-3.5 text-sm outline-none"
        />
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-500">No results</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && (
                  <p role="presentation" className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {header}
                  </p>
                )}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={c.run}
                  className={`mx-2 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    i === active ? 'bg-brand-50 text-brand-700' : 'text-gray-800'
                  }`}
                >
                  <span>{c.label}</span>
                  {c.hint && <span className="truncate ps-4 text-xs text-gray-400">{c.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
          ↑↓ to move · Enter to open · Esc to close
        </p>
      </div>
    </div>
  );
}
