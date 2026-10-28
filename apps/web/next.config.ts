import type { NextConfig } from 'next';

// Hosts may give just "host:port" (Render's private address); default to plain http,
// which stays on the private network.
const rawApiUrl = process.env.API_URL ?? 'http://localhost:4000';
const apiUrl = /^https?:\/\//.test(rawApiUrl) ? rawApiUrl : `http://${rawApiUrl}`;

const nextConfig: NextConfig = {
  // The browser only ever talks to this origin; /api/* is proxied to the API.
  // Same-origin requests keep the session cookie first-party and avoid CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [
      // The Content Security Policy is set per request in proxy.ts.
      {
        source: '/((?!api/).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Check-in uses the camera (selfies) and location; nothing else is needed.
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()' },
          ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
        ],
      },
      // The service worker must never be cached, so an update reaches everyone straight away.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
  poweredByHeader: false,
};

export default nextConfig;
