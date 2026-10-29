import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { ServiceWorker } from '@/components/shell/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: 'WorkHub',
  description: 'Attendance, projects, clients and team chat in one workspace.',
  applicationName: 'WorkHub',
  appleWebApp: { capable: true, title: 'WorkHub', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#0e8673',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request, so each page gets the Content Security Policy nonce (proxy.ts).
  await connection();
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
