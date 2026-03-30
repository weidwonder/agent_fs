// packages/storage-cloud/src/cloud-archive-adapter.ts

import type { DocumentArchiveAdapter } from '@agent-fs/storage-adapter';
import { putObject, getObject, deleteObject, objectExists, listObjects } from './s3.js';

export class CloudArchiveAdapter implements DocumentArchiveAdapter {
  constructor(private readonly tenantId: string) {}

  private key(fileId: string, fileName: string): string {
    return `${this.tenantId}/${fileId}/${fileName}`;
  }

  async write(fileId: string, content: { files: Record<string, string> }): Promise<void> {
    await Promise.all(
      Object.entries(content.files).map(([fileName, data]) =>
        putObject(this.key(fileId, fileName), Buffer.from(data, 'utf-8')),
      ),
    );
  }

  async read(fileId: string, fileName: string): Promise<string> {
    const buf = await getObject(this.key(fileId, fileName));
    return buf.toString('utf-8');
  }

  async readBatch(fileId: string, fileNames: string[]): Promise<Record<string, string>> {
    const results = await Promise.all(
      fileNames.map(async (name) => {
        const buf = await getObject(this.key(fileId, name));
        return [name, buf.toString('utf-8')] as [string, string];
      }),
    );
    return Object.fromEntries(results);
  }

  async exists(fileId: string): Promise<boolean> {
    // Check if any object exists under the prefix
    const keys = await listObjects(`${this.tenantId}/${fileId}/`);
    if (keys.length > 0) return true;
    // Fallback: check content.md for backward compat
    return objectExists(this.key(fileId, 'content.md'));
  }

  async delete(fileId: string): Promise<void> {
    const prefix = `${this.tenantId}/${fileId}/`;
    const keys = await listObjects(prefix);
    await Promise.all(keys.map((k) => deleteObject(k).catch(() => {})));
  }

  async close(): Promise<void> {
    // S3 client is shared; no cleanup needed
  }
}
