import { Injectable } from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config';

/** Files on a local volume, laid out as <uploadDir>/<tenantId>/<uuid>. */
@Injectable()
export class StorageService {
  private readonly root = resolve(config.uploadDir);

  async save(tenantId: string, data: Buffer): Promise<string> {
    const key = `${tenantId}/${randomUUID()}`;
    const path = this.pathFor(key);
    await fs.mkdir(join(this.root, tenantId), { recursive: true });
    await fs.writeFile(path, data, { mode: 0o600 });
    return key;
  }

  stream(key: string) {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string) {
    await fs.rm(this.pathFor(key), { force: true });
  }

  async removeTenant(tenantId: string) {
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) return;
    await fs.rm(join(this.root, tenantId), { recursive: true, force: true });
  }

  private pathFor(key: string) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid storage key');
    return join(this.root, key);
  }
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_').trim();
  return (cleaned || 'file').slice(0, 180);
}
