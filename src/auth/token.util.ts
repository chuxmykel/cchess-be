import { createHmac, randomBytes } from 'node:crypto';

export function generateOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(rawToken: string, secret: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}
