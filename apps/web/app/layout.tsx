import { isRtl, LOCALE_COOKIE, LOCALES, type Locale } from '@workhub/shared';
import type { Metadata, Viewport } from 'next';
import { Noto_Naskh_Arabic } from 'next/font/google';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { ServiceWorker } from '@/components/shell/service-worker';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

// Urdu script, self-hosted at build time. Naskh rather than Nastaliq: it stays legible in
// small UI text and fits normal line heights.
const urdu = Noto_Naskh_Arabic({ subsets: ['arabic'], weight: ['400', '600', '700'], variable: '--font-urdu', display: 'swap' });

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
  // Rendered per request, so each page gets the Content Security Policy nonce (proxy.ts)
  // and the person's language before anything shows.
  await connection();
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = (LOCALES as readonly string[]).includes(stored ?? '') ? (stored as Locale) : 'en';
  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} className={urdu.variable}>
      <body className="antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
