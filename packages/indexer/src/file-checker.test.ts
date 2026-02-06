import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileChecker } from './file-checker';

describe('FileChecker', () => {
  it('小文件使用 MD5 哈希', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fs-file-checker-'));
    const filePath = join(dir, 'small.txt');
    writeFileSync(filePath, 'hello world');

    const checker = new FileChecker();
    const result = await checker.checkFileChanged(filePath, { hash: '' });

    const expectedHash = createHash('md5').update('hello world').digest('hex');
    expect(result.hash).toBe(expectedHash);
    expect(result.changed).toBe(true);

    const unchanged = await checker.checkFileChanged(filePath, { hash: expectedHash });
    expect(unchanged.changed).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('超阈值文件使用 size:mtime 哈希', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fs-file-checker-'));
    const filePath = join(dir, 'large.txt');
    writeFileSync(filePath, 'x');

    const checker = new FileChecker({ sizeThresholdBytes: 0 });
    const stats = statSync(filePath);
    const expectedHash = `${stats.size}:${stats.mtime.getTime()}`;

    const result = await checker.checkFileChanged(filePath, { hash: '' });
    expect(result.hash).toBe(expectedHash);
    expect(result.changed).toBe(true);

    utimesSync(filePath, stats.atime, new Date(stats.mtime.getTime() + 1000));
    const changed = await checker.checkFileChanged(filePath, { hash: expectedHash });
    expect(changed.changed).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
