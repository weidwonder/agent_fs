import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IndexMetadata } from '@agent-fs/core';
import { createVectorStore, InvertedIndex } from '@agent-fs/search';
import { createAFDStorage } from '@agent-fs/storage';
import {
  LocalVectorStoreAdapter,
  LocalInvertedIndexAdapter,
  LocalArchiveAdapter,
} from '@agent-fs/storage-adapter';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { PluginManager } from './plugin-manager';
import { IndexPipeline } from './pipeline';

interface IntegrationContext {
  projectDir: string;
  storageDir: string;
  pluginManager: PluginManager;
  embeddingService: {
    embed: ReturnType<typeof vi.fn>;
  };
  summaryService: {
    generateDocumentSummary: ReturnType<typeof vi.fn>;
    generateDirectorySummary: ReturnType<typeof vi.fn>;
  };
  vectorStore: ReturnType<typeof createVectorStore>;
  invertedIndex: InvertedIndex;
}

function readIndexMetadata(dirPath: string): IndexMetadata {
  const indexPath = join(dirPath, '.fs_index', 'index.json');
  return JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadata;
}

function collectAllArchiveRefs(
  metadata: IndexMetadata,
  currentDirPath: string
): Array<{ dirPath: string; archiveName: string; fileId: string }> {
  const refs = metadata.files.map((file) => ({
    dirPath: currentDirPath,
    archiveName: file.afdName ?? file.name ?? file.fileId,
    fileId: file.fileId,
  }));

  for (const subdirectory of metadata.subdirectories) {
    const childPath = join(currentDirPath, subdirectory.name);
    const childMetadata = readIndexMetadata(childPath);
    refs.push(...collectAllArchiveRefs(childMetadata, childPath));
  }

  return refs;
}

async function createContext(): Promise<IntegrationContext> {
  const projectDir = mkdtempSync(join(tmpdir(), 'agent-fs-indexer-integration-project-'));
  const storageDir = mkdtempSync(join(tmpdir(), 'agent-fs-indexer-integration-storage-'));

  const pluginManager = new PluginManager();
  pluginManager.register(new MarkdownPlugin());

  const embeddingService = {
    embed: vi.fn(async (text: string) => {
      if (text.includes('alpha')) return [1, 0, 0];
      if (text.includes('beta')) return [0, 1, 0];
      if (text.includes('gamma')) return [0, 0, 1];
      return [0.1, 0.1, 0.1];
    }),
  };

  const summaryService = {
    generateDocumentSummary: vi.fn(async () => ({ summary: '' })),
    generateDirectorySummary: vi.fn(async () => ({ summary: '' })),
  };

  const vectorStore = createVectorStore({
    storagePath: join(storageDir, 'vectors'),
    dimension: 3,
  });
  await vectorStore.init();

  const invertedIndex = new InvertedIndex({
    dbPath: join(storageDir, 'inverted-index', 'inverted-index.db'),
  });
  await invertedIndex.init();

  return {
    projectDir,
    storageDir,
    pluginManager,
    embeddingService,
    summaryService,
    vectorStore,
    invertedIndex,
  };
}

function createPipeline(context: IntegrationContext): IndexPipeline {
  const archiveCache = new Map<string, LocalArchiveAdapter>();
  const archiveResolver = (dirPath: string): LocalArchiveAdapter => {
    const cached = archiveCache.get(dirPath);
    if (cached) {
      return cached;
    }

    const afdStorage = createAFDStorage({
      documentsDir: join(dirPath, '.fs_index', 'documents'),
    });
    const adapter = new LocalArchiveAdapter(afdStorage);
    archiveCache.set(dirPath, adapter);
    return adapter;
  };

  const storage = {
    vector: new LocalVectorStoreAdapter(context.vectorStore),
    invertedIndex: new LocalInvertedIndexAdapter(context.invertedIndex),
    archive: archiveResolver(context.projectDir),
    metadata: {} as any,
    clue: {
      init: async () => {},
      listClues: async () => [],
      getClue: async () => null,
      saveClue: async () => {},
      deleteClue: async () => {},
      removeLeavesByFileId: vi.fn().mockResolvedValue({
        affectedClues: [],
        removedLeaves: 0,
        removedFolders: 0,
      }),
      close: async () => {},
    },
    init: async () => {},
    close: async () => {},
  };

  return new IndexPipeline({
    dirPath: context.projectDir,
    pluginManager: context.pluginManager,
    embeddingService: context.embeddingService as any,
    summaryService: context.summaryService as any,
    storage,
    archiveResolver,
    chunkOptions: { minTokens: 1, maxTokens: 200 },
    summaryOptions: {
      mode: 'skip',
    },
  });
}

describe('IndexPipeline Integration', () => {
  let context: IntegrationContext;

  beforeEach(async () => {
    context = await createContext();
  });

  afterEach(async () => {
    await context.invertedIndex.close();
    await context.vectorStore.close();
    rmSync(context.projectDir, { recursive: true, force: true });
    rmSync(context.storageDir, { recursive: true, force: true });
  });

  it('应完成递归索引并写入跨层级存储', async () => {
    mkdirSync(join(context.projectDir, 'docs', 'nested'), { recursive: true });
    writeFileSync(join(context.projectDir, 'root.md'), '# Root\n\n根词条 星云');
    writeFileSync(join(context.projectDir, 'docs', 'a.md'), '# A\n\n目录词条 海豚');
    writeFileSync(join(context.projectDir, 'docs', 'nested', 'b.md'), '# B\n\n火星海象');

    const rootMetadata = await createPipeline(context).run();
    const docsMetadata = readIndexMetadata(join(context.projectDir, 'docs'));
    const nestedMetadata = readIndexMetadata(join(context.projectDir, 'docs', 'nested'));

    expect(rootMetadata.relativePath).toBe('.');
    expect(docsMetadata.parentDirId).toBe(rootMetadata.dirId);
    expect(nestedMetadata.parentDirId).toBe(docsMetadata.dirId);
    expect(rootMetadata.stats.fileCount).toBe(3);

    const archiveRefs = collectAllArchiveRefs(rootMetadata, context.projectDir);
    expect(archiveRefs.length).toBe(3);

    for (const ref of archiveRefs) {
      const storage = createAFDStorage({
        documentsDir: join(ref.dirPath, '.fs_index', 'documents'),
      });
      expect(await storage.exists(ref.archiveName)).toBe(true);
    }

    const nestedResults = await context.invertedIndex.search('火星海象', { topK: 10 });
    expect(nestedResults.some((item) => item.fileId === nestedMetadata.files[0].fileId)).toBe(true);

    expect(await context.vectorStore.countRows()).toBe(rootMetadata.stats.chunkCount);
  });

  it('应支持增量新增删除修改并保持存储一致', async () => {
    mkdirSync(join(context.projectDir, 'docs'), { recursive: true });
    writeFileSync(join(context.projectDir, 'root.md'), '# Root\n\n根词条 旧版');
    writeFileSync(join(context.projectDir, 'docs', 'a.md'), '# A\n\n旧词条 海豚');

    const firstRootMetadata = await createPipeline(context).run();
    const firstDocsMetadata = readIndexMetadata(join(context.projectDir, 'docs'));

    const oldRoot = firstRootMetadata.files.find((file) => file.name === 'root.md');
    const oldDeleted = firstDocsMetadata.files.find((file) => file.name === 'a.md');
    expect(oldRoot).toBeDefined();
    expect(oldDeleted).toBeDefined();

    writeFileSync(join(context.projectDir, 'root.md'), '# Root\n\n根词条 新版');
    rmSync(join(context.projectDir, 'docs', 'a.md'), { force: true });
    writeFileSync(join(context.projectDir, 'docs', 'new.md'), '# New\n\n新增词条 树熊');

    const secondRootMetadata = await createPipeline(context).run();
    const secondDocsMetadata = readIndexMetadata(join(context.projectDir, 'docs'));

    const newRoot = secondRootMetadata.files.find((file) => file.name === 'root.md');
    const newAdded = secondDocsMetadata.files.find((file) => file.name === 'new.md');
    expect(newRoot?.fileId).toBe(oldRoot?.fileId);
    expect(newAdded).toBeDefined();
    expect(secondDocsMetadata.files.some((file) => file.name === 'a.md')).toBe(false);

    const docsStorage = createAFDStorage({
      documentsDir: join(context.projectDir, 'docs', '.fs_index', 'documents'),
    });
    expect(
      await docsStorage.exists(oldDeleted!.afdName ?? oldDeleted!.name ?? oldDeleted!.fileId)
    ).toBe(false);

    const removedResults = await context.invertedIndex.search('海豚', { topK: 10 });
    expect(removedResults.some((item) => item.fileId === oldDeleted!.fileId)).toBe(false);

    const newFileResults = await context.invertedIndex.search('树熊', { topK: 10 });
    expect(newFileResults.some((item) => item.fileId === newAdded!.fileId)).toBe(true);

    expect(secondRootMetadata.stats.fileCount).toBe(2);
    expect(await context.vectorStore.countRows()).toBe(secondRootMetadata.stats.chunkCount);
  });
});
