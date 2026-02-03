import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface ScanResult {
  supportedFiles: string[];
  unsupportedFiles: string[];
  subdirectories: string[];
}

export function scanDirectory(
  dirPath: string,
  supportedExtensions: string[]
): ScanResult {
  const supported: string[] = [];
  const unsupported: string[] = [];
  const subdirs: string[] = [];

  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    if (entry.startsWith('.')) continue; // 跳过隐藏文件

    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      subdirs.push(entry);
    } else if (stat.isFile()) {
      const ext = extname(entry).slice(1).toLowerCase();
      if (supportedExtensions.includes(ext)) {
        supported.push(entry);
      } else {
        unsupported.push(entry);
      }
    }
  }

  return {
    supportedFiles: supported,
    unsupportedFiles: unsupported,
    subdirectories: subdirs,
  };
}
