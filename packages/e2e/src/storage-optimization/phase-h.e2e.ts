import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IndexMetadata, Registry } from '@agent-fs/core';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { PluginManager } from '../../../indexer/src/plugin-manager';
import { IndexPipeline } from '../../../indexer/src/pipeline';
import { createAFDStorage } from '../../../storage/src';
import { createVectorStore, InvertedIndex, fusionRRF } from '../../../search/src';

const runtimeState = {
  homeDir: '',
};

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => runtimeState.homeDir,
  };
});

import {
  search,
  __setSearchServicesForTest,
  __resetSearchServicesForTest,
} from '../../../mcp-server/src/tools/search';
import { getChunk } from '../../../mcp-server/src/tools/get-chunk';
import { listIndexes } from '../../../mcp-server/src/tools/list-indexes';
import { dirTree } from '../../../mcp-server/src/tools/dir-tree';

interface HContext {
  homeDir: string;
  projectDir: string;
  storageDir: string;
  pluginManager: PluginManager;
  embeddingService: {
    embed: ReturnType<typeof vi.fn>;
  };
  summaryService: {
    generateChunkSummariesBatch: ReturnType<typeof vi.fn>;
    generateChunkSummary: ReturnType<typeof vi.fn>;
    generateDocumentSummary: ReturnType<typeof vi.fn>;
    generateDirectorySummary: ReturnType<typeof vi.fn>;
  };
  vectorStore: ReturnType<typeof createVectorStore>;
  invertedIndex: InvertedIndex;
  afdStorage: ReturnType<typeof createAFDStorage>;
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function readIndexMetadata(dirPath: string): IndexMetadata {
  return JSON.parse(readFileSync(join(dirPath, '.fs_index', 'index.json'), 'utf-8')) as IndexMetadata;
}

function collectSubdirectoryRefs(projectPath: string): Registry['projects'][number]['subdirectories'] {
  const root = readIndexMetadata(projectPath);
  const refs: Registry['projects'][number]['subdirectories'] = [];
  const stack: IndexMetadata[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const subdirectory of current.subdirectories) {
      const childPath = join(current.directoryPath, subdirectory.name);
      if (!existsSync(join(childPath, '.fs_index', 'index.json'))) {
        continue;
      }

      const child = readIndexMetadata(childPath);
      refs.push({
        relativePath: child.relativePath,
        dirId: child.dirId,
        fileCount: child.stats.fileCount,
        chunkCount: child.stats.chunkCount,
        lastUpdated: child.updatedAt,
      });
      stack.push(child);
    }
  }

  return refs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function writeRegistry(homeDir: string, metadata: IndexMetadata): void {
  const registryDir = join(homeDir, '.agent_fs');
  mkdirSync(registryDir, { recursive: true });

  const registry: Registry = {
    version: '2.0',
    embeddingModel: 'mock-e2e',
    embeddingDimension: 4,
    projects: [
      {
        path: metadata.directoryPath,
        alias: basename(metadata.directoryPath),
        projectId: metadata.projectId,
        summary: metadata.directorySummary,
        lastUpdated: metadata.updatedAt,
        totalFileCount: metadata.stats.fileCount,
        totalChunkCount: metadata.stats.chunkCount,
        subdirectories: collectSubdirectoryRefs(metadata.directoryPath),
        valid: true,
      },
    ],
  };

  writeFileSync(join(registryDir, 'registry.json'), JSON.stringify(registry, null, 2));
}

function createPipeline(context: HContext): IndexPipeline {
  return new IndexPipeline({
    dirPath: context.projectDir,
    pluginManager: context.pluginManager,
    embeddingService: context.embeddingService as any,
    summaryService: context.summaryService as any,
    vectorStore: context.vectorStore,
    invertedIndex: context.invertedIndex,
    afdStorage: context.afdStorage,
    chunkOptions: { minTokens: 1, maxTokens: 200 },
    summaryOptions: {
      mode: 'skip',
      tokenBudget: 10000,
    },
  });
}

async function runIndexAndSyncRegistry(context: HContext): Promise<IndexMetadata> {
  const metadata = await createPipeline(context).run();
  writeRegistry(context.homeDir, metadata);
  return metadata;
}

async function createContext(): Promise<HContext> {
  const homeDir = createTempDir('agent-fs-h-home-');
  const projectDir = createTempDir('agent-fs-h-project-');
  const storageDir = join(homeDir, '.agent_fs', 'storage');
  runtimeState.homeDir = homeDir;
  mkdirSync(storageDir, { recursive: true });

  const pluginManager = new PluginManager();
  pluginManager.register(new MarkdownPlugin());

  const embeddingService = {
    embed: vi.fn(async (text: string) => {
      if (text.includes('火星海象') || text.includes('深层工具词') || text.includes('目标词A')) {
        return [1, 0, 0, 0];
      }
      if (text.includes('海豚') || text.includes('旧海豚词')) {
        return [0, 1, 0, 0];
      }
      if (text.includes('树熊') || text.includes('新增树熊词') || text.includes('目标词B')) {
        return [0, 0, 1, 0];
      }
      return [0.1, 0.1, 0.1, 0.1];
    }),
  };

  const summaryService = {
    generateChunkSummariesBatch: vi.fn(async (chunks: Array<{ id: string }>) =>
      chunks.map((chunk) => ({ id: chunk.id, summary: '' }))
    ),
    generateChunkSummary: vi.fn(async () => ({ summary: '' })),
    generateDocumentSummary: vi.fn(async () => ({ summary: '' })),
    generateDirectorySummary: vi.fn(async () => ({ summary: '' })),
  };

  const vectorStore = createVectorStore({
    storagePath: join(storageDir, 'vectors'),
    dimension: 4,
  });
  await vectorStore.init();

  const invertedIndex = new InvertedIndex({
    dbPath: join(storageDir, 'inverted-index', 'inverted-index.db'),
  });
  await invertedIndex.init();

  const afdStorage = createAFDStorage({
    documentsDir: join(projectDir, '.fs_index', 'documents'),
  });

  return {
    homeDir,
    projectDir,
    storageDir,
    pluginManager,
    embeddingService,
    summaryService,
    vectorStore,
    invertedIndex,
    afdStorage,
  };
}

async function disposeContext(context: HContext): Promise<void> {
  __resetSearchServicesForTest();
  await context.invertedIndex.close();
  await context.vectorStore.close();
  rmSync(context.projectDir, { recursive: true, force: true });
  rmSync(context.homeDir, { recursive: true, force: true });
}

describe('Phase H: Storage Optimization E2E', () => {
  let context: HContext;

  beforeEach(async () => {
    context = await createContext();
  });

  afterEach(async () => {
    await disposeContext(context);
  });

  it('H.1 完整索引流程：递归索引 + 向量/倒排/融合搜索', async () => {
    mkdirSync(join(context.projectDir, 'docs', 'nested'), { recursive: true });
    writeFileSync(join(context.projectDir, 'root.md'), '# Root\n\n根目录内容');
    writeFileSync(join(context.projectDir, 'docs', 'a.md'), '# Docs\n\n海豚区域内容');
    writeFileSync(join(context.projectDir, 'docs', 'nested', 'b.md'), '# Nested\n\n火星海象关键字');

    const metadata = await runIndexAndSyncRegistry(context);
    const nestedMetadata = readIndexMetadata(join(context.projectDir, 'docs', 'nested'));
    const nestedFileId = nestedMetadata.files[0].fileId;

    expect(metadata.stats.fileCount).toBe(3);
    expect(metadata.subdirectories.length).toBeGreaterThan(0);

    const queryVector = await context.embeddingService.embed('火星海象');
    const vectorResults = await context.vectorStore.searchByContent(queryVector, { topK: 10 });
    expect(
      vectorResults.some((item) => String((item.document as any).file_path).endsWith('b.md'))
    ).toBe(true);

    const keywordResults = await context.invertedIndex.search('火星海象', { topK: 10 });
    expect(keywordResults.some((item) => item.fileId === nestedFileId)).toBe(true);

    const fused = fusionRRF(
      [
        {
          name: 'vector',
          items: vectorResults.map((item) => ({
            chunkId: item.chunk_id,
            filePath: String((item.document as any).file_path),
          })),
        },
        {
          name: 'inverted',
          items: keywordResults.map((item) => ({
            chunkId: item.chunkId,
            fileId: item.fileId,
          })),
        },
      ],
      (item) => item.chunkId,
      (existing, next) => ({ ...existing, ...next })
    );

    expect(fused.length).toBeGreaterThan(0);
    expect(
      fused.some(
        (item) =>
          (item.item as any).fileId === nestedFileId ||
          String((item.item as any).filePath ?? '').endsWith('b.md')
      )
    ).toBe(true);
  });

  it('H.2 增量更新：新增/删除/修改仅影响变更文件', async () => {
    mkdirSync(join(context.projectDir, 'docs'), { recursive: true });
    writeFileSync(join(context.projectDir, 'root.md'), '# Root\n\n旧根词');
    writeFileSync(join(context.projectDir, 'docs', 'a.md'), '# Docs\n\n旧海豚词');

    const firstRoot = await runIndexAndSyncRegistry(context);
    const firstDocs = readIndexMetadata(join(context.projectDir, 'docs'));

    const oldRoot = firstRoot.files.find((file) => file.name === 'root.md');
    const oldRemoved = firstDocs.files.find((file) => file.name === 'a.md');
    expect(oldRoot).toBeDefined();
    expect(oldRemoved).toBeDefined();

    writeFileSync(join(context.projectDir, 'root.md'), '# Root\n\n新根词');
    rmSync(join(context.projectDir, 'docs', 'a.md'), { force: true });
    writeFileSync(join(context.projectDir, 'docs', 'new.md'), '# New\n\n新增树熊词');

    const secondRoot = await runIndexAndSyncRegistry(context);
    const secondDocs = readIndexMetadata(join(context.projectDir, 'docs'));

    const newRoot = secondRoot.files.find((file) => file.name === 'root.md');
    const newAdded = secondDocs.files.find((file) => file.name === 'new.md');

    expect(newRoot?.fileId).toBe(oldRoot?.fileId);
    expect(newAdded).toBeDefined();
    expect(secondDocs.files.some((file) => file.name === 'a.md')).toBe(false);
    expect(await context.afdStorage.exists(oldRemoved!.fileId)).toBe(false);

    const removedKeyword = await context.invertedIndex.search('旧海豚词', { topK: 10 });
    expect(removedKeyword.some((item) => item.fileId === oldRemoved!.fileId)).toBe(false);

    const addedKeyword = await context.invertedIndex.search('新增树熊词', { topK: 10 });
    expect(addedKeyword.some((item) => item.fileId === newAdded!.fileId)).toBe(true);

    expect(secondRoot.stats.fileCount).toBe(2);
    expect(await context.vectorStore.countRows()).toBe(secondRoot.stats.chunkCount);
  });

  it('H.3 层级搜索：Project/子目录/多目录范围正确', async () => {
    mkdirSync(join(context.projectDir, 'docs', 'nested'), { recursive: true });
    mkdirSync(join(context.projectDir, 'notes'), { recursive: true });
    writeFileSync(join(context.projectDir, 'root.md'), '# Root\n\n公共说明');
    writeFileSync(join(context.projectDir, 'docs', 'a.md'), '# Docs\n\n目标词A 文档目录');
    writeFileSync(join(context.projectDir, 'docs', 'nested', 'b.md'), '# Nested\n\n目标词A 深层目录');
    writeFileSync(join(context.projectDir, 'notes', 'c.md'), '# Notes\n\n目标词B 笔记目录');

    await runIndexAndSyncRegistry(context);

    __setSearchServicesForTest({
      embeddingService: context.embeddingService as any,
      vectorStore: context.vectorStore as any,
      invertedIndex: context.invertedIndex,
    });

    const docsPath = join(context.projectDir, 'docs');
    const notesPath = join(context.projectDir, 'notes');

    const projectScopeResult = await search({
      query: '目标词A',
      keyword: '目标词A',
      scope: context.projectDir,
      top_k: 20,
    });
    expect(projectScopeResult.results.some((item) => item.source.file_path.startsWith(docsPath))).toBe(
      true
    );

    const docsScopeResult = await search({
      query: '目标词A',
      keyword: '目标词A',
      scope: docsPath,
      top_k: 20,
    });
    expect(docsScopeResult.results.length).toBeGreaterThan(0);
    expect(docsScopeResult.results.every((item) => item.source.file_path.startsWith(docsPath))).toBe(
      true
    );

    const multiScopeResult = await search({
      query: '目标词B',
      keyword: '目标词B',
      scope: [docsPath, notesPath],
      top_k: 20,
    });
    expect(
      multiScopeResult.results.some((item) => item.source.file_path.startsWith(notesPath))
    ).toBe(true);
    expect(
      multiScopeResult.results.every(
        (item) =>
          item.source.file_path.startsWith(docsPath) || item.source.file_path.startsWith(notesPath)
      )
    ).toBe(true);
  });

  it('H.4 MCP 工具：list_indexes / dir_tree / search / get_chunk 联动可用', async () => {
    mkdirSync(join(context.projectDir, 'docs', 'nested'), { recursive: true });
    writeFileSync(join(context.projectDir, 'root.md'), '# Root\n\n根目录工具词');
    writeFileSync(join(context.projectDir, 'docs', 'nested', 'b.md'), '# Nested\n\n深层工具词');

    await runIndexAndSyncRegistry(context);

    __setSearchServicesForTest({
      embeddingService: context.embeddingService as any,
      vectorStore: context.vectorStore as any,
      invertedIndex: context.invertedIndex,
    });

    const indexes = await listIndexes();
    expect(indexes.indexes).toHaveLength(1);
    expect(indexes.indexes[0].path).toBe(context.projectDir);
    expect(indexes.indexes[0].subdirectories.length).toBeGreaterThan(0);

    const tree = await dirTree({ scope: context.projectDir, depth: 3 });
    const docsNode = tree.subdirectories.find((item) => item.path === 'docs');
    expect(docsNode).toBeDefined();
    expect(docsNode?.subdirectories.some((item) => item.path === 'nested')).toBe(true);

    const searchResult = await search({
      query: '深层工具词',
      keyword: '深层工具词',
      scope: context.projectDir,
      top_k: 5,
    });
    expect(searchResult.results.length).toBeGreaterThan(0);

    const chunkResult = await getChunk({
      chunk_id: searchResult.results[0].chunk_id,
      include_neighbors: true,
      neighbor_count: 1,
    });
    expect(chunkResult.chunk.content).toContain('深层工具词');
  });
});
