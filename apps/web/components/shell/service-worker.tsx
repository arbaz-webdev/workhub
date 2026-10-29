'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';

/** Registers the service worker in production builds (in development it would fight hot reload). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
  }, []);
  return null;
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** "Install app", shown only when the browser offers to install WorkHub. */
export function InstallButton() {
  const t = useT();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!prompt) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await prompt.prompt();
        await prompt.userChoice;
        setPrompt(null);
      }}
      className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 md:inline"
    >
      {t('shell.install')}
    </button>
  );
}
