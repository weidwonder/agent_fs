import { mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TEST_DATA_DIR, TEST_TEMP_PREFIX } from './test-config';

export function createTempTestDir(): string {
  const tempDir = join(
    tmpdir(),
    `${TEST_TEMP_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

export function cleanupTempDir(tempDir: string): void {
  if (tempDir.includes(TEST_TEMP_PREFIX)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function copyTestFile(filename: string, tempDir: string): string {
  const srcPath = join(TEST_DATA_DIR, filename);
  const destPath = join(tempDir, filename);

  if (!existsSync(srcPath)) {
    throw new Error(`Test file not found: ${srcPath}`);
  }

  cpSync(srcPath, destPath);
  return destPath;
}

export function copyAllTestFiles(tempDir: string): void {
  cpSync(TEST_DATA_DIR, tempDir, { recursive: true });
}
