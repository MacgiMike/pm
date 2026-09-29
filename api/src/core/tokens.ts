import { createHash, createHmac, randomBytes } from 'crypto';
import { config } from '../config';

/** Random URL-safe token (default 32 bytes = 256 bits). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Task-link tokens look like a GUID but carry 256 bits of randomness. */
export function newGuidToken(): string {
  const h = randomBytes(32).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 64)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHmac('sha256', config.appSecret).update(ip).digest('hex').slice(0, 32);
}
