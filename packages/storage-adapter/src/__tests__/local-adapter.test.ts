import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { VectorStore } from '@agent-fs/search';
import { InvertedIndex } from '@agent-fs/search';
import { AFDStorage } from '@agent-fs/storage';
import {
  LocalVectorStoreAdapter,
  LocalInvertedIndexAdapter,
  LocalArchiveAdapter,
  LocalMetadataAdapter,
  LocalClueAdapter,
  createLocalAdapter,
} from '../local/index.js';
import type { Clue, Registry } from '@agent-fs/core';
import type { VectorDocument, IndexMetadata } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'storage-adapter-test-'));
}

function makeDoc(overrides: Partial<VectorDocument> = {}): VectorDocument {
  return {
    chunk_id: 'chunk-1',
    file_id: 'file-1',
    dir_id: 'dir-1',
    rel_path: 'doc.md',
    file_path: '/root/doc.md',
    chunk_line_start: 1,
    chunk_line_end: 10,
    content_vector: [0.1, 0.2, 0.3, 0.4],
    locator: 'L1',
    indexed_at: new Date().toISOString(),
    deleted_at: '',
    ...overrides,
  };
}

function makeMetadata(dirId: string): IndexMetadata {
  return {
    version: '1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dirId,
    directoryPath: `/root/${dirId}`,
    directorySummary: 'test',
    projectId: 'proj-1',
    relativePath: '.',
    parentDirId: null,
    stats: { fileCount: 1, chunkCount: 5, totalTokens: 100 },
    files: [],
    subdirectories: [],
    unsupportedFiles: [],
  };
}

function makeClue(projectId: string, overrides: Partial<Clue> = {}): Clue {
  return {
    id: 'clue-001',
    projectId,
    name: '认证系统演进',
    description: '认证系统知识组织',
    principle: '按主题组织',
    createdAt: '2026-04-23T00:00:00.000Z',
    updatedAt: '2026-04-23T00:00:00.000Z',
    root: {
      kind: 'folder',
      organization: 'tree',
      name: '',
      summary: '认证系统知识组织',
      children: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// LocalVectorStoreAdapter
// ---------------------------------------------------------------------------

describe('LocalVectorStoreAdapter', () => {
  let tmpDir: string;
  let adapter: LocalVectorStoreAdapter;

  beforeAll(async () => {
    tmpDir = makeTempDir();
    const store = new VectorStore({ storagePath: join(tmpDir, 'vectors'), dimension: 4 });
    adapter = new LocalVectorStoreAdapter(store);
    await adapter.init();
  });

  afterAll(async () => {
    await adapter.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addDocuments + searchByVector returns results', async () => {
    const doc = makeDoc({ chunk_id: 'v-1', file_id: 'f-1', dir_id: 'd-1' });
    await adapter.addDocuments([doc]);

    const results = await adapter.searchByVector({
      vector: [0.1, 0.2, 0.3, 0.4],
      dirIds: ['d-1'],
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe('v-1');
    expect(typeof results[0].score).toBe('number');
    expect(results[0].document).toBeDefined();
  });

  it('getByChunkIds returns matching documents', async () => {
    const doc = makeDoc({ chunk_id: 'v-get', file_id: 'f-get', dir_id: 'd-get' });
    await adapter.addDocuments([doc]);

    const docs = await adapter.getByChunkIds(['v-get']);
    expect(docs.length).toBe(1);
    expect(docs[0].chunk_id).toBe('v-get');
  });

  it('deleteByFileId removes documents', async () => {
    const doc = makeDoc({ chunk_id: 'v-del', file_id: 'f-del', dir_id: 'd-del' });
    await adapter.addDocuments([doc]);
    await adapter.deleteByFileId('f-del');

    const docs = await adapter.getByChunkIds(['v-del']);
    expect(docs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LocalInvertedIndexAdapter
// ---------------------------------------------------------------------------

describe('LocalInvertedIndexAdapter', () => {
  let tmpDir: string;
  let adapter: LocalInvertedIndexAdapter;

  beforeAll(async () => {
    tmpDir = makeTempDir();
    const index = new InvertedIndex({
      dbPath: join(tmpDir, 'inverted-index.db'),
    });
    adapter = new LocalInvertedIndexAdapter(index);
    await adapter.init();
  });

  afterAll(async () => {
    await adapter.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addFile + search returns results', async () => {
    // Use Chinese text that jieba tokenizer handles reliably
    await adapter.addFile('file-1', 'dir-1', [
      { text: '人工智能技术研究', chunkId: 'c-1', locator: 'L1' },
    ]);

    const results = await adapter.search({
      terms: ['人工智能', '技术'],
      dirIds: ['dir-1'],
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe('c-1');
    expect(typeof results[0].score).toBe('number');
  });

  it('removeFile clears entries', async () => {
    await adapter.addFile('file-rm', 'dir-rm', [
      { text: '量子计算机科学', chunkId: 'c-rm', locator: 'L1' },
    ]);
    await adapter.removeFile('file-rm');

    const results = await adapter.search({
      terms: ['量子计算', '科学'],
      dirIds: ['dir-rm'],
      topK: 5,
    });
    expect(results.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LocalArchiveAdapter
// ---------------------------------------------------------------------------

describe('LocalArchiveAdapter', () => {
  let tmpDir: string;
  let adapter: LocalArchiveAdapter;

  beforeAll(() => {
    tmpDir = makeTempDir();
    const storage = new AFDStorage({ documentsDir: join(tmpDir, 'archives') });
    adapter = new LocalArchiveAdapter(storage);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('write + read roundtrip', async () => {
    await adapter.write('arc-1', { files: { 'content.txt': 'hello storage' } });
    const text = await adapter.read('arc-1', 'content.txt');
    expect(text).toBe('hello storage');
  });

  it('write + readBatch returns all files', async () => {
    await adapter.write('arc-batch', {
      files: { 'a.txt': 'alpha', 'b.txt': 'beta' },
    });
    const batch = await adapter.readBatch('arc-batch', ['a.txt', 'b.txt']);
    expect(batch['a.txt']).toBe('alpha');
    expect(batch['b.txt']).toBe('beta');
  });

  it('exists returns true/false correctly', async () => {
    await adapter.write('arc-ex', { files: { 'f.txt': 'x' } });
    expect(await adapter.exists('arc-ex')).toBe(true);
    expect(await adapter.exists('arc-nonexistent-xyz')).toBe(false);
  });

  it('delete removes archive', async () => {
    await adapter.write('arc-del', { files: { 'f.txt': 'x' } });
    await adapter.delete('arc-del');
    expect(await adapter.exists('arc-del')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LocalMetadataAdapter
// ---------------------------------------------------------------------------

describe('LocalMetadataAdapter', () => {
  let tmpDir: string;
  let adapter: LocalMetadataAdapter;

  beforeAll(() => {
    tmpDir = makeTempDir();
    adapter = new LocalMetadataAdapter({
      metadataDir: join(tmpDir, 'metadata'),
      registryPath: join(tmpDir, 'registry.json'),
    });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeIndexMetadata + readIndexMetadata roundtrip', async () => {
    const meta = makeMetadata('dir-rw');
    await adapter.writeIndexMetadata('dir-rw', meta);

    const read = await adapter.readIndexMetadata('dir-rw');
    expect(read).not.toBeNull();
    expect(read!.dirId).toBe('dir-rw');
    expect(read!.directorySummary).toBe('test');
  });

  it('readIndexMetadata returns null for unknown dirId', async () => {
    expect(await adapter.readIndexMetadata('dir-nonexistent-xyz')).toBeNull();
  });

  it('deleteIndexMetadata removes metadata', async () => {
    await adapter.writeIndexMetadata('dir-del', makeMetadata('dir-del'));
    await adapter.deleteIndexMetadata('dir-del');
    expect(await adapter.readIndexMetadata('dir-del')).toBeNull();
  });

  it('writeProjectMemoryFile + readProjectMemory roundtrip', async () => {
    await adapter.writeProjectMemoryFile('proj-1', 'notes.md', '# Notes');
    const memory = await adapter.readProjectMemory('proj-1');
    expect(memory).not.toBeNull();
    expect(memory!.files.some((f) => f.name === 'notes.md')).toBe(true);
  });

  it('readProjectMemory returns null for unknown project', async () => {
    expect(await adapter.readProjectMemory('proj-nonexistent-xyz')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LocalClueAdapter
// ---------------------------------------------------------------------------

describe('LocalClueAdapter', () => {
  let tmpDir: string;
  let projectAPath: string;
  let projectBPath: string;
  let adapter: LocalClueAdapter;
  let registryPath: string;

  beforeAll(async () => {
    tmpDir = makeTempDir();
    projectAPath = join(tmpDir, 'project-a');
    projectBPath = join(tmpDir, 'project-b');
    registryPath = join(tmpDir, 'registry.json');

    mkdirSync(join(projectAPath, '.fs_index'), { recursive: true });
    mkdirSync(join(projectBPath, '.fs_index'), { recursive: true });

    const registry: Registry = {
      version: '2.0',
      embeddingModel: 'mock',
      embeddingDimension: 4,
      projects: [
        {
          path: projectAPath,
          alias: 'project-a',
          projectId: 'project-a',
          summary: 'A',
          lastUpdated: '2026-04-23T00:00:00.000Z',
          totalFileCount: 0,
          totalChunkCount: 0,
          subdirectories: [],
          valid: true,
        },
        {
          path: projectBPath,
          alias: 'project-b',
          projectId: 'project-b',
          summary: 'B',
          lastUpdated: '2026-04-23T00:00:00.000Z',
          totalFileCount: 0,
          totalChunkCount: 0,
          subdirectories: [],
          valid: true,
        },
      ],
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    adapter = new LocalClueAdapter({ registryPath });
    await adapter.init();
  });

  afterAll(async () => {
    await adapter.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveClue 应写入项目 .fs_index/clues 目录', async () => {
    const clue = makeClue('project-a');
    await adapter.saveClue(clue);

    expect(await adapter.getClue(clue.id)).toEqual(clue);
    expect(existsSync(join(projectAPath, '.fs_index', 'clues', 'registry.json'))).toBe(true);
    expect(existsSync(join(projectAPath, '.fs_index', 'clues', `${clue.id}.json`))).toBe(true);
  });

  it('listClues 应按 projectId 过滤', async () => {
    await adapter.saveClue(makeClue('project-a', { id: 'clue-a-1', name: 'A-1' }));
    await adapter.saveClue(makeClue('project-b', { id: 'clue-b-1', name: 'B-1' }));

    const projectAClues = await adapter.listClues('project-a');
    expect(projectAClues.map((item) => item.id).sort()).toEqual(['clue-001', 'clue-a-1']);
    expect(projectAClues.every((item) => typeof item.leafCount === 'number')).toBe(true);
  });

  it('同一项目下 duplicate clue name 应报错，但不同项目允许同名', async () => {
    await expect(
      adapter.saveClue(makeClue('project-a', { id: 'clue-a-dup', name: '认证系统演进' }))
    ).rejects.toThrow(/Clue 名称已存在/u);

    await expect(
      adapter.saveClue(makeClue('project-b', { id: 'clue-b-dup', name: '认证系统演进' }))
    ).resolves.toBeUndefined();
  });

  it('deleteClue 应移除项目内文件与 registry 条目', async () => {
    const clue = makeClue('project-a', { id: 'clue-delete', name: '待删除' });
    await adapter.saveClue(clue);

    await adapter.deleteClue(clue.id);

    expect(await adapter.getClue(clue.id)).toBeNull();
    const registry = JSON.parse(
      readFileSync(join(projectAPath, '.fs_index', 'clues', 'registry.json'), 'utf-8')
    ) as { clues: Array<{ id: string }> };
    expect(registry.clues.some((item) => item.id === clue.id)).toBe(false);
  });

  it('removeLeavesByFileId 应清理匹配 leaf 并更新 registry leafCount', async () => {
    const clue = makeClue('project-a', {
      id: 'clue-prune',
      name: '待清理',
      root: {
        kind: 'folder',
        organization: 'tree',
        name: '',
        summary: '待清理',
        children: [
          {
            kind: 'folder',
            organization: 'tree',
            name: '认证',
            summary: '认证',
            children: [
              {
                kind: 'leaf',
                name: '旧文档',
                summary: '旧文档',
                segment: {
                  fileId: 'file-delete',
                  type: 'document',
                },
              },
            ],
          },
          {
            kind: 'leaf',
            name: '保留文档',
            summary: '保留文档',
            segment: {
              fileId: 'file-keep',
              type: 'document',
            },
          },
        ],
      },
    });
    await adapter.saveClue(clue);

    const result = await adapter.removeLeavesByFileId('project-a', 'file-delete');
    const updated = await adapter.getClue('clue-prune');
    const registry = JSON.parse(
      readFileSync(join(projectAPath, '.fs_index', 'clues', 'registry.json'), 'utf-8')
    ) as { clues: Array<{ id: string; leafCount?: number }> };

    expect(result).toEqual({
      affectedClues: ['clue-prune'],
      removedLeaves: 1,
      removedFolders: 1,
    });
    expect(updated?.root.children).toHaveLength(1);
    expect(updated?.root.children[0]).toMatchObject({
      kind: 'leaf',
      name: '保留文档',
    });
    expect(registry.clues.find((item) => item.id === 'clue-prune')?.leafCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createLocalAdapter (factory)
// ---------------------------------------------------------------------------

describe('createLocalAdapter factory', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a StorageAdapter with all sub-adapters', async () => {
    const adapter = createLocalAdapter({
      storagePath: tmpDir,
      dimension: 4,
      registryPath: join(tmpDir, 'registry.json'),
    });

    expect(adapter.vector).toBeDefined();
    expect(adapter.invertedIndex).toBeDefined();
    expect(adapter.archive).toBeDefined();
    expect(adapter.metadata).toBeDefined();
    expect(adapter.clue).toBeDefined();

    await adapter.init();
    await adapter.close();
  });
});
