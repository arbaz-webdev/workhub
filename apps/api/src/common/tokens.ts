import { createHash, randomBytes } from 'node:crypto';

/** A random 256-bit, URL-safe token. Send it to the user; store only its hash. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
