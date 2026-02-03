import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { Registry, IndexMetadata, Config } from '@agent-fs/core';
import { loadConfig } from '@agent-fs/core';
import { createEmbeddingService, createSummaryService } from '@agent-fs/llm';
import { createVectorStore, BM25Index, saveIndex as saveBM25 } from '@agent-fs/search';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { PDFPlugin } from '@agent-fs/plugin-pdf';
import { PluginManager } from './plugin-manager';
import { IndexPipeline, type IndexProgress } from './pipeline';

export interface IndexerOptions {
  configPath?: string;
  onProgress?: (progress: IndexProgress) => void;
}

export class Indexer {
  private config: Config;
  private pluginManager: PluginManager;
  private options: IndexerOptions;

  constructor(options: IndexerOptions = {}) {
    this.options = options;
    this.config = loadConfig({ configPath: options.configPath });
    this.pluginManager = new PluginManager();

    // 注册默认插件
    this.pluginManager.register(new MarkdownPlugin());
    this.pluginManager.register(new PDFPlugin());
  }

  async init(): Promise<void> {
    await this.pluginManager.initAll();
  }

  async indexDirectory(dirPath: string): Promise<IndexMetadata> {
    const storagePath = join(homedir(), '.agent_fs', 'storage');
    mkdirSync(join(storagePath, 'vectors'), { recursive: true });
    mkdirSync(join(storagePath, 'bm25'), { recursive: true });

    // 初始化服务
    const embeddingService = createEmbeddingService(this.config.embedding);
    await embeddingService.init();

    const summaryService = createSummaryService(this.config.llm);

    const vectorStore = createVectorStore({
      storagePath: join(storagePath, 'vectors'),
      dimension: embeddingService.getDimension(),
    });
    await vectorStore.init();

    const bm25Index = new BM25Index();

    // 运行流水线
    const chunkSize = this.config.indexing.chunk_size;
    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: this.pluginManager,
      embeddingService,
      summaryService,
      vectorStore,
      bm25Index,
      chunkOptions: {
        minTokens: chunkSize.min_tokens,
        maxTokens: chunkSize.max_tokens,
      },
      onProgress: this.options.onProgress,
    });

    const metadata = await pipeline.run();

    // 保存 BM25 索引
    saveBM25(bm25Index, join(storagePath, 'bm25', 'index.json'));

    // 更新 registry
    this.updateRegistry(metadata);

    // 清理
    await vectorStore.close();
    await embeddingService.dispose();

    return metadata;
  }

  private updateRegistry(metadata: IndexMetadata): void {
    const registryPath = join(homedir(), '.agent_fs', 'registry.json');

    let registry: Registry;
    if (existsSync(registryPath)) {
      registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    } else {
      registry = {
        version: '1.0',
        embeddingModel: this.config.embedding.local?.model || this.config.embedding.api?.model || '',
        embeddingDimension: 512,
        indexedDirectories: [],
      };
    }

    // 更新或添加目录
    const existing = registry.indexedDirectories.find(
      (d) => d.path === metadata.directoryPath
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

  async dispose(): Promise<void> {
    await this.pluginManager.disposeAll();
  }
}

export function createIndexer(options?: IndexerOptions): Indexer {
  return new Indexer(options);
}
