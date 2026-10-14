import { createHmac, randomBytes } from 'node:crypto';

// Comfortably beyond what's needed to make brute-force guessing infeasible
// for an opaque, long-lived (30-day default) refresh token.
const REFRESH_TOKEN_BYTES = 48;

export function generateOpaqueToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export function hashToken(rawToken: string, secret: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}
