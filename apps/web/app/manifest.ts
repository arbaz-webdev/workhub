import type { MetadataRoute } from 'next';

/** Installs WorkHub to the home screen or desktop, opening straight into the app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WorkHub',
    short_name: 'WorkHub',
    description: 'Attendance, projects, CRM and chat for your team.',
    id: '/app',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f8fa',
    theme_color: '#0e8673',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Check in', url: '/app/attendance', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'Inbox', url: '/app/inbox', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
