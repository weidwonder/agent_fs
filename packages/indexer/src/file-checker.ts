import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

export interface FileCheckerOptions {
  sizeThresholdBytes?: number;
}

export interface FileHashReference {
  hash: string;
}

export interface FileChangeResult {
  changed: boolean;
  hash: string;
}

export class FileChecker {
  private readonly sizeThresholdBytes: number;

  constructor(options: FileCheckerOptions = {}) {
    this.sizeThresholdBytes = options.sizeThresholdBytes ?? 200 * 1024 * 1024;
  }

  async checkFileChanged(
    filePath: string,
    oldMetadata: FileHashReference
  ): Promise<FileChangeResult> {
    const fileStat = await stat(filePath);
    const hash = await this.buildHash(filePath, fileStat.size, fileStat.mtime.getTime());

    return {
      changed: hash !== oldMetadata.hash,
      hash,
    };
  }

  private async buildHash(
    filePath: string,
    fileSize: number,
    modifiedAt: number
  ): Promise<string> {
    if (fileSize > this.sizeThresholdBytes) {
      return `${fileSize}:${modifiedAt}`;
    }

    const content = await readFile(filePath);
    return createHash('md5').update(content).digest('hex');
  }
}
