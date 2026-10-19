'use client';

import type { MeResponse, WorkspaceDto } from '@workhub/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommandPalette } from '@/components/shell/command-palette';
import { FirstWorkspace } from '@/components/shell/first-workspace';
import { NotificationsBell } from '@/components/shell/notifications-bell';
import { Sidebar } from '@/components/shell/sidebar';
import { VerifyBanner } from '@/components/shell/verify-banner';
import { roleLabel } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { readStoredWorkspace, storeWorkspace, WorkspaceContext } from '@/lib/workspace';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse>();
  const [workspace, setWorkspace] = useState<WorkspaceDto>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<MeResponse>('/auth/me');
      setMe(data);
      setWorkspace((current) => {
        const wanted = current?.id ?? readStoredWorkspace();
        return data.workspaces.find((w) => w.id === wanted) ?? data.workspaces[0];
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      }
    }
  }, [router, pathname]);

  // Load once; pages call refresh() after changes that affect the user or their workspaces.
  useEffect(() => {
    void refresh();
  }, []);

  const switchTo = useCallback((next: WorkspaceDto) => {
    storeWorkspace(next.id);
    setWorkspace(next);
  }, []);

  const context = useMemo(
    () => (me && workspace ? { me, workspace, switchTo, refresh } : null),
    [me, workspace, switchTo, refresh],
  );

  async function signOut() {
    await api('/auth/sign-out', { method: 'POST' }).catch(() => {});
    router.replace('/sign-in');
  }

  if (!me) return <p className="p-8 text-sm text-gray-500">Loading your workspace…</p>;

  if (!workspace || !context) {
    return (
      <FirstWorkspace
        name={me.user.name}
        onCreated={(w) => {
          setMe({ ...me, workspaces: [...me.workspaces, w] });
          switchTo(w);
        }}
      />
    );
  }

  return (
    <WorkspaceContext.Provider value={context}>
      <div className="flex min-h-full">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-white lg:block">
          <div className="sticky top-0 h-screen overflow-y-auto">
            <Sidebar />
          </div>
        </aside>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-gray-900/30" onClick={() => setMenuOpen(false)} />
            <aside className="relative h-full w-64 overflow-y-auto bg-white shadow-xl">
              <Sidebar onNavigate={() => setMenuOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
            <div className="flex items-center gap-2 px-4 py-2.5 lg:px-8">
              <button
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                className="grid h-9 w-9 place-items-center rounded-lg text-gray-600 hover:bg-gray-100 lg:hidden"
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {me.workspaces.length > 1 ? (
                <select
                  aria-label="Switch workspace"
                  value={workspace.id}
                  onChange={(e) => {
                    const next = me.workspaces.find((w) => w.id === e.target.value);
                    if (next) {
                      switchTo(next);
                      router.push('/app');
                    }
                  }}
                  className="max-w-[45vw] truncate rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium"
                >
                  {me.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="truncate text-sm font-semibold">{workspace.name}</span>
              )}

              <button
                onClick={() => setSearchOpen(true)}
                className="ml-auto hidden items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 sm:flex"
              >
                Search
                <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 text-[11px] text-gray-500">Ctrl K</kbd>
              </button>
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Search"
                className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-gray-600 hover:bg-gray-100 sm:hidden"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </button>

              <NotificationsBell key={workspace.id} />

              <span className="hidden text-sm text-gray-600 md:inline">
                {me.user.name} · {roleLabel(workspace.role)}
              </span>
              <button onClick={signOut} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                Sign out
              </button>
            </div>
          </header>

          {!me.user.emailVerified && <VerifyBanner email={me.user.email} />}

          <main key={workspace.id} className="w-full max-w-5xl flex-1 px-4 py-8 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </WorkspaceContext.Provider>
  );
}
