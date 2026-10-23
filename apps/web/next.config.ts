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
  poweredByHeader: false,
};

export default nextConfig;
