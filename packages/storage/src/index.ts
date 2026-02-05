export interface StorageOptions {
  documentsDir: string;
  cacheSize?: number;
}

export interface ReadRequest {
  fileId: string;
  filePath: string;
}

export class AFDStorage {
  constructor(options: StorageOptions);
  write(fileId: string, files: Record<string, string | Buffer>): Promise<void>;
  read(fileId: string, filePath: string): Promise<Buffer>;
  readText(fileId: string, filePath: string): Promise<string>;
  readBatch(requests: ReadRequest[]): Promise<Buffer[]>;
  exists(fileId: string): Promise<boolean>;
  delete(fileId: string): Promise<void>;
}

export function createAFDStorage(options: StorageOptions): AFDStorage;
