import { NextResponse, type NextRequest } from 'next/server';

/**
 * Downloads redirect to short-lived links on the file store (Cloudflare R2), so images
 * and files shown in the app may load from there. Its origin comes from the same
 * S3_ENDPOINT the API uses (one container on staging shares the environment).
 */
function fileStoreOrigin(): string {
  try {
    return process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : '';
  } catch {
    return '';
  }
}

/**
 * Content Security Policy with a fresh nonce on every page view: only scripts Next.js
 * renders (which carry the nonce) and what they load can run, so injected markup can't.
 * Styles allow inline attributes, which components use for widths and colours.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const files = fileStoreOrigin();
  const csp = [
    "default-src 'self'",
    // React needs eval in development only, for its error overlays.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${files}`.trim(),
    `media-src 'self' blob: ${files}`.trim(),
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API, Next's own files, or public files such as sw.js and icons.
      source: '/((?!api/|_next/static|_next/image|.*\\.[a-z0-9]+$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
