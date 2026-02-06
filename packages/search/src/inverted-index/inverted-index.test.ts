import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { InvertedIndex } from './inverted-index';

const makeDb = () => mkdtempSync(join(tmpdir(), 'agent-fs-inv-'));

describe('InvertedIndex', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = makeDb();
    dbPath = join(dir, 'inverted-index.db');
  });

  it('add/search/remove', async () => {
    const index = new InvertedIndex({ dbPath });
    await index.init();

    await index.addFile('f1', 'd1', [{ text: '你好 世界', chunkId: 'c1', locator: 'lines:1-1' }]);

    const results = await index.search('世界', { dirIds: ['d1'], topK: 10 });
    expect(results.length).toBeGreaterThan(0);

    await index.removeFile('f1');
    const results2 = await index.search('世界', { dirIds: ['d1'], topK: 10 });
    expect(results2.length).toBe(0);

    await index.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('directory filter', async () => {
    const index = new InvertedIndex({ dbPath });
    await index.init();

    await index.addFile('f1', 'd1', [{ text: 'alpha beta', chunkId: 'c1', locator: 'lines:1-1' }]);
    await index.addFile('f2', 'd2', [{ text: 'alpha beta', chunkId: 'c2', locator: 'lines:1-1' }]);

    const d1 = await index.search('alpha', { dirIds: ['d1'], topK: 10 });
    const d2 = await index.search('alpha', { dirIds: ['d2'], topK: 10 });

    expect(d1.every((r) => r.dirId === 'd1')).toBe(true);
    expect(d2.every((r) => r.dirId === 'd2')).toBe(true);

    await index.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
