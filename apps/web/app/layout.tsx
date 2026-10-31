import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { connection } from 'next/server';
import { ServiceWorker } from '@/components/shell/service-worker';
import './globals.css';

// Self-hosted at build time: visitors' browsers never contact Google.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'WorkHub',
  description: 'Attendance, projects, clients and team chat in one workspace.',
  applicationName: 'WorkHub',
  appleWebApp: { capable: true, title: 'WorkHub', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#ecebef',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request, so each page gets the Content Security Policy nonce (proxy.ts).
  await connection();
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
