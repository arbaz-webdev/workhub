import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // The browser only ever talks to this origin; /api/* is proxied to the API.
  // Same-origin requests keep the session cookie first-party and avoid CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
  poweredByHeader: false,
};

export default nextConfig;
