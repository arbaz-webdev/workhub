'use client';

import type { MeResponse, WorkspaceDto } from '@workhub/shared';
import { LogOut, Menu, Search } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommandPalette } from '@/components/shell/command-palette';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { InstallButton } from '@/components/shell/service-worker';
import { FirstWorkspace } from '@/components/shell/first-workspace';
import { NotificationsBell } from '@/components/shell/notifications-bell';
import { Logo, Sidebar } from '@/components/shell/sidebar';
import { TimerChip } from '@/components/shell/timer-chip';
import { VerifyBanner } from '@/components/shell/verify-banner';
import { btn, roleLabel } from '@/components/ui';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { InboxProvider } from '@/lib/inbox';
import { readStoredWorkspace, storeWorkspace, WorkspaceContext } from '@/lib/workspace';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse>();
  const [workspace, setWorkspace] = useState<WorkspaceDto>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<MeResponse>('/auth/me');
      setMe(data);
      setUnreachable(false);
      setWorkspace((current) => {
        const wanted = current?.id ?? readStoredWorkspace();
        return data.workspaces.find((w) => w.id === wanted) ?? data.workspaces[0];
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      } else {
        // The server is starting (a deploy, or waking from sleep) or the network dropped.
        setUnreachable(true);
        throw err;
      }
    }
  }, [router, pathname]);

  // Load once, retrying until the server answers; pages call refresh() after changes
  // that affect the user or their workspaces.
  useEffect(() => {
    let cancelled = false;
    let delay = 2000;
    const load = () =>
      refresh().catch(() => {
        if (cancelled) return;
        setTimeout(load, delay);
        delay = Math.min(delay * 2, 30_000);
      });
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const switchTo = useCallback((next: WorkspaceDto) => {
    storeWorkspace(next.id);
    setWorkspace(next);
  }, []);

  // Pages refresh after their own changes; a failed refresh just keeps what's shown.
  const refreshQuietly = useCallback(() => refresh().catch(() => {}), [refresh]);
  const context = useMemo(
    () => (me && workspace ? { me, workspace, switchTo, refresh: refreshQuietly } : null),
    [me, workspace, switchTo, refreshQuietly],
  );

  async function signOut() {
    await api('/auth/sign-out', { method: 'POST' }).catch(() => {});
    router.replace('/sign-in');
  }

  if (!me) {
    return (
      <div role="status" className="grid min-h-full place-items-center p-8">
        <div className="flex animate-fade flex-col items-center gap-4 text-center">
          <span className="animate-pulse">
            <Logo size={48} />
          </span>
          <p className="max-w-xs text-sm text-gray-500">
            {unreachable ? 'WorkHub is starting up. This can take up to a minute; it will open by itself.' : 'Loading your workspace…'}
          </p>
        </div>
      </div>
    );
  }

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
      <InboxProvider key={workspace.id}>
        <div className="flex min-h-full">
          {/* Desktop sidebar: a white panel floating on the canvas */}
          <aside className="hidden w-64 shrink-0 lg:block print:hidden">
            <div className="sticky top-0 h-screen p-3 pr-0">
              <div className="h-full overflow-y-auto rounded-3xl bg-white shadow-sm">
                <Sidebar />
              </div>
            </div>
          </aside>

          {/* Mobile drawer */}
          {menuOpen && (
            <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
              <div className="absolute inset-0 animate-fade bg-ink/30 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
              <aside className="relative m-2 h-[calc(100%-1rem)] w-64 animate-[wh-rise_0.35s_var(--ease-out-soft)_both] overflow-y-auto rounded-3xl bg-white shadow-lg">
                <Sidebar onNavigate={() => setMenuOpen(false)} />
              </aside>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 bg-canvas/80 backdrop-blur-md print:hidden">
              <div className="flex items-center gap-2 px-4 py-3 lg:px-8">
                <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className={`${btn.icon} bg-white shadow-sm lg:hidden`}>
                  <Menu aria-hidden="true" size={18} strokeWidth={1.75} />
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
                    className="max-w-[45vw] cursor-pointer truncate rounded-full border-0 bg-white py-2 pl-4 pr-8 text-sm font-medium shadow-sm"
                  >
                    {me.workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="max-w-[40vw] shrink-0 truncate rounded-full bg-white px-4 py-2 text-sm font-medium shadow-sm">{workspace.name}</span>
                )}

                <button
                  onClick={() => setSearchOpen(true)}
                  className="ml-auto hidden w-40 items-center gap-2 rounded-full bg-white xl:w-64 py-2 pl-3.5 pr-2 text-sm text-gray-400 shadow-sm transition hover:text-gray-600 hover:shadow-md sm:flex"
                >
                  <Search aria-hidden="true" size={16} strokeWidth={1.75} />
                  <span className="flex-1 text-left">Search</span>
                  <kbd className="rounded-full bg-gray-100 px-2 py-0.5 font-sans text-[11px] text-gray-500">Ctrl K</kbd>
                </button>
                <button onClick={() => setSearchOpen(true)} aria-label="Search" className={`${btn.icon} ml-auto bg-white shadow-sm sm:hidden`}>
                  <Search aria-hidden="true" size={18} strokeWidth={1.75} />
                </button>

                <span className="hidden sm:inline">
                  <TimerChip key={workspace.id} />
                </span>
                <InstallButton />
                <FeedbackButton />
                <NotificationsBell key={workspace.id} />

                <Link
                  href="/app/account"
                  title="Account and security"
                  className="flex items-center gap-2.5 rounded-full bg-white p-1 shadow-sm transition hover:shadow-md md:pr-4"
                >
                  <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-lime text-xs font-semibold text-ink">
                    {initials(me.user.name)}
                  </span>
                  <span className="hidden text-left leading-tight md:block">
                    <span className="block whitespace-nowrap text-sm font-medium">{me.user.name}</span>
                    <span className="block text-[11px] text-gray-500">{roleLabel(workspace.role)}</span>
                  </span>
                  <span className="sr-only md:hidden">Account</span>
                </Link>
                <button onClick={signOut} aria-label="Sign out" title="Sign out" className={`${btn.icon} bg-white shadow-sm`}>
                  <LogOut aria-hidden="true" size={17} strokeWidth={1.75} />
                </button>
              </div>
            </header>

            {!me.user.emailVerified && <VerifyBanner email={me.user.email} />}

            {/* The inbox uses the whole width and height for its panes. */}
            <main key={workspace.id} className={pathname.startsWith('/app/inbox') ? 'w-full flex-1 px-0 py-0 sm:px-4 sm:py-4 lg:px-6' : 'w-full max-w-6xl flex-1 px-4 pb-12 pt-6 lg:px-8'}>
              {/* A workspace that requires two-factor sign-in waits until it's on (the API refuses too). */}
              {workspace.requireTwoFactor && !me.user.twoFactorEnabled && !pathname.startsWith('/app/account') ? (
                <div className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-sm">
                  <h1 className="text-lg font-semibold">Turn on two-factor sign-in</h1>
                  <p className="mt-2 text-sm text-gray-600">{workspace.name} asks everyone to sign in with a code from an authenticator app as well as their password. It takes a minute.</p>
                  <Link href="/app/account" className={`${btn.primary} mt-4`}>
                    Set it up
                  </Link>
                </div>
              ) : (
                // Keyed by section (CRM, Projects…), so its blocks rise in when you arrive, but not
                // again on every tab inside it.
                <div key={pathname.split('/')[2] ?? 'home'} className="page-enter contents">
                  {children}
                </div>
              )}
            </main>
          </div>
        </div>
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      </InboxProvider>
    </WorkspaceContext.Provider>
  );
}
