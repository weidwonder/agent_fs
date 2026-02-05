import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { Registry, IndexMetadata, Config } from '@agent-fs/core';
import { loadConfig } from '@agent-fs/core';
import { createEmbeddingService, createSummaryService } from '@agent-fs/llm';
import { createVectorStore, BM25Index, saveIndex as saveBM25 } from '../packages/search/src/index';
import { MarkdownPlugin } from '../packages/plugins/plugin-markdown/src/plugin';
import { ExcelPlugin, type ExcelPluginOptions } from '../packages/plugins/plugin-excel/src/plugin';
import { PluginManager } from '../packages/indexer/src/plugin-manager';
import { IndexPipeline, type IndexProgress } from '../packages/indexer/src/pipeline';

function updateRegistry(metadata: IndexMetadata, config: Config, dimension: number): void {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');

  let registry: Registry;
  if (existsSync(registryPath)) {
    registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  } else {
    registry = {
      version: '1.0',
      embeddingModel: config.embedding.local?.model || config.embedding.api?.model || '',
      embeddingDimension: dimension,
      indexedDirectories: [],
    };
  }

  const existing = registry.indexedDirectories.find(
    (d) => d.path === metadata.directoryPath,
  );

  if (existing) {
    existing.dirId = metadata.dirId;
    existing.summary = metadata.directorySummary;
    existing.lastUpdated = metadata.updatedAt;
    existing.fileCount = metadata.stats.fileCount;
    existing.chunkCount = metadata.stats.chunkCount;
    existing.valid = true;
  } else {
    registry.indexedDirectories.push({
      path: metadata.directoryPath,
      alias: metadata.directoryPath.split('/').pop() || '',
      dirId: metadata.dirId,
      summary: metadata.directorySummary,
      lastUpdated: metadata.updatedAt,
      fileCount: metadata.stats.fileCount,
      chunkCount: metadata.stats.chunkCount,
      valid: true,
    });
  }

  mkdirSync(join(homedir(), '.agent_fs'), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

const config = loadConfig();
const useMock = process.env.AGENT_FS_MOCK_EMBEDDING === '1';

const pluginManager = new PluginManager();
pluginManager.register(new MarkdownPlugin());
const excelOptions = (config.plugins?.excel as ExcelPluginOptions | undefined) ?? {};
pluginManager.register(new ExcelPlugin(excelOptions));
await pluginManager.initAll();

const storagePath = join(homedir(), '.agent_fs', 'storage');
mkdirSync(join(storagePath, 'vectors'), { recursive: true });
mkdirSync(join(storagePath, 'bm25'), { recursive: true });

const embeddingService = useMock
  ? {
      init: async () => {},
      getDimension: () => 8,
      embed: async (text: string) => {
        const vector = new Array(8).fill(0);
        for (let i = 0; i < text.length && i < 80; i++) {
          vector[i % 8] += text.charCodeAt(i) / 1000;
        }
        const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        return vector.map((v) => v / (norm || 1));
      },
      dispose: async () => {},
    }
  : createEmbeddingService(config.embedding);

if (!useMock) {
  await embeddingService.init();
}

const summaryService = useMock
  ? {
      generateChunkSummary: async (content: string) => ({
        summary: content.slice(0, 200),
        fromCache: false,
        fallback: true,
      }),
      generateDocumentSummary: async (_filename: string, chunkSummaries: string[]) => ({
        summary: chunkSummaries.slice(0, 3).join(' '),
        fromCache: false,
        fallback: true,
      }),
      generateDirectorySummary: async (
        _path: string,
        fileSummaries: string[],
        subdirSummaries: string[],
      ) => ({
        summary: `包含 ${fileSummaries.length} 个文件和 ${subdirSummaries.length} 个子目录`,
        fromCache: false,
        fallback: true,
      }),
    }
  : createSummaryService(config.llm);

const vectorStore = createVectorStore({
  storagePath: join(storagePath, 'vectors'),
  dimension: embeddingService.getDimension(),
});
await vectorStore.init();

const bm25Index = new BM25Index();

const targetDir = process.argv[2] ?? './test-data';

const pipeline = new IndexPipeline({
  dirPath: targetDir,
  pluginManager,
  embeddingService,
  summaryService,
  vectorStore,
  bm25Index,
  chunkOptions: {
    minTokens: config.indexing.chunk_size.min_tokens,
    maxTokens: config.indexing.chunk_size.max_tokens,
  },
  onProgress: (p: IndexProgress) => {
    console.log('PROGRESS', p.phase, p.currentFile, `${p.processed}/${p.total}`);
  },
});

const metadata = await pipeline.run();

saveBM25(bm25Index, join(storagePath, 'bm25', 'index.json'));
updateRegistry(metadata, config, embeddingService.getDimension());

await vectorStore.close();
await embeddingService.dispose();
await pluginManager.disposeAll();

console.log('INDEX_DIR', metadata.directoryPath);
console.log('FS_INDEX', `${metadata.directoryPath}/.fs_index`);
console.log('FILES', metadata.files.map((f) => f.name).join(','));
console.log('SUBDIRS', metadata.subdirectories.map((s) => s.name).join(','));
