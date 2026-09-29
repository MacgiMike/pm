import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { config } from '../config';

const key = () => createHash('sha256').update(`totp:${config.appSecret}`).digest();

/** AES-256-GCM, used for TOTP secrets at rest. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decrypt(blob: string): string {
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('bad secret');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
