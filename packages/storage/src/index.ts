import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const native = require('../storage.node') as {
  AfdStorage: new (documentsDir: string, cacheSize?: number) => {
    write(fileId: string, files: Record<string, string | Buffer>): Promise<void>;
    read(fileId: string, filePath: string): Promise<Buffer>;
    read_text(fileId: string, filePath: string): Promise<string>;
    read_batch(requests: { file_id: string; file_path: string }[]): Promise<Buffer[]>;
    exists(fileId: string): Promise<boolean>;
    delete(fileId: string): Promise<void>;
  };
};

export interface StorageOptions {
  documentsDir: string;
  cacheSize?: number;
}

export interface ReadRequest {
  fileId: string;
  filePath: string;
}

export class AFDStorage {
  private inner: InstanceType<typeof native.AfdStorage>;

  constructor(options: StorageOptions) {
    this.inner = new native.AfdStorage(options.documentsDir, options.cacheSize);
  }

  write(fileId: string, files: Record<string, string | Buffer>) {
    return this.inner.write(fileId, files);
  }

  read(fileId: string, filePath: string) {
    return this.inner.read(fileId, filePath);
  }

  readText(fileId: string, filePath: string) {
    return this.inner.read_text(fileId, filePath);
  }

  readBatch(requests: ReadRequest[]) {
    return this.inner.read_batch(
      requests.map((r) => ({ file_id: r.fileId, file_path: r.filePath }))
    );
  }

  exists(fileId: string) {
    return this.inner.exists(fileId);
  }

  delete(fileId: string) {
    return this.inner.delete(fileId);
  }
}

export function createAFDStorage(options: StorageOptions): AFDStorage {
  return new AFDStorage(options);
}
