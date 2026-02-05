import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAFDStorage } from './index';

const makeTmp = () => mkdtempSync(join(tmpdir(), 'agent-fs-storage-'));

describe('AFDStorage', () => {
  it('write/read/readText/exists/delete', async () => {
    const dir = makeTmp();
    const storage = createAFDStorage({ documentsDir: dir, cacheSize: 10 });

    await storage.write('file1', {
      'content.md': '# 标题\n内容',
      'summaries.json': JSON.stringify({ c1: '摘要' })
    });

    expect(await storage.exists('file1')).toBe(true);

    const content = await storage.readText('file1', 'content.md');
    expect(content).toContain('标题');

    const buf = await storage.read('file1', 'summaries.json');
    expect(JSON.parse(buf.toString()).c1).toBe('摘要');

    await storage.delete('file1');
    expect(await storage.exists('file1')).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('readBatch', async () => {
    const dir = makeTmp();
    const storage = createAFDStorage({ documentsDir: dir });

    await storage.write('file1', { 'content.md': 'A' });
    await storage.write('file2', { 'content.md': 'B' });

    const results = await storage.readBatch([
      { fileId: 'file1', filePath: 'content.md' },
      { fileId: 'file2', filePath: 'content.md' }
    ]);

    expect(results.map((b) => b.toString())).toEqual(['A', 'B']);

    rmSync(dir, { recursive: true, force: true });
  });
});
