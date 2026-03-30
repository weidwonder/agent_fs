import type { AFDStorage } from '@agent-fs/storage';
import type { DocumentArchiveAdapter } from '../types.js';

export class LocalArchiveAdapter implements DocumentArchiveAdapter {
  constructor(private readonly storage: AFDStorage) {}

  async write(
    fileId: string,
    content: { files: Record<string, string> },
  ): Promise<void> {
    await this.storage.write(fileId, content.files);
  }

  async read(fileId: string, fileName: string): Promise<string> {
    return this.storage.readText(fileId, fileName);
  }

  async readBatch(
    fileId: string,
    fileNames: string[],
  ): Promise<Record<string, string>> {
    const requests = fileNames.map((filePath) => ({ fileId, filePath }));
    const buffers = await this.storage.readBatch(requests);
    const result: Record<string, string> = {};
    for (let i = 0; i < fileNames.length; i++) {
      result[fileNames[i]] = buffers[i].toString('utf-8');
    }
    return result;
  }

  async exists(fileId: string): Promise<boolean> {
    return this.storage.exists(fileId);
  }

  async delete(fileId: string): Promise<void> {
    await this.storage.delete(fileId);
  }

  async close(): Promise<void> {
    // AFDStorage has no close method — no-op
  }
}
