import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { Registry, IndexMetadata, Config } from '@agent-fs/core';
import { loadConfig } from '@agent-fs/core';
import { createEmbeddingService, createSummaryService } from '@agent-fs/llm';
import { createVectorStore, InvertedIndex } from '@agent-fs/search';
import { createAFDStorage } from '@agent-fs/storage';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { PDFPlugin } from '@agent-fs/plugin-pdf';
import { DocxPlugin } from '@agent-fs/plugin-docx';
import { ExcelPlugin } from '@agent-fs/plugin-excel';
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
    const pluginOptions = this.resolvePluginOptions();

    // 注册默认插件
    this.pluginManager.register(new MarkdownPlugin());
    this.pluginManager.register(new PDFPlugin(pluginOptions.pdf));
    this.pluginManager.register(new DocxPlugin(pluginOptions.docx));
    this.pluginManager.register(new ExcelPlugin(pluginOptions.excel));
  }

  async init(): Promise<void> {
    await this.pluginManager.initAll();
  }

  async indexDirectory(dirPath: string): Promise<IndexMetadata> {
    const storagePath = join(homedir(), '.agent_fs', 'storage');
    mkdirSync(join(storagePath, 'vectors'), { recursive: true });
    mkdirSync(join(storagePath, 'inverted-index'), { recursive: true });

    // 初始化服务
    const embeddingService = createEmbeddingService(this.config.embedding);
    await embeddingService.init();

    const summaryService = createSummaryService(this.config.llm);

    const vectorStore = createVectorStore({
      storagePath: join(storagePath, 'vectors'),
      dimension: embeddingService.getDimension(),
    });
    await vectorStore.init();

    const invertedIndex = new InvertedIndex({
      dbPath: join(storagePath, 'inverted-index', 'inverted-index.db'),
    });
    await invertedIndex.init();

    const afdStorage = createAFDStorage({
      documentsDir: join(dirPath, '.fs_index', 'documents'),
    });
    const afdStorageByDir = new Map<string, ReturnType<typeof createAFDStorage>>();
    const afdStorageResolver = (targetDirPath: string) => {
      const cached = afdStorageByDir.get(targetDirPath);
      if (cached) {
        return cached;
      }

      const storage = createAFDStorage({
        documentsDir: join(targetDirPath, '.fs_index', 'documents'),
      });
      afdStorageByDir.set(targetDirPath, storage);
      return storage;
    };

    // 运行流水线
    const chunkSize = this.config.indexing.chunk_size;
    const summaryConfig = this.config.summary;
    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: this.pluginManager,
      embeddingService,
      summaryService,
      vectorStore,
      invertedIndex,
      afdStorage,
      afdStorageResolver,
      chunkOptions: {
        minTokens: chunkSize.min_tokens,
        maxTokens: chunkSize.max_tokens,
      },
      fileParallelism: this.config.indexing.file_parallelism ?? 2,
      summaryOptions: {
        mode: summaryConfig?.mode ?? 'batch',
        tokenBudget: summaryConfig?.chunk_batch_token_budget ?? 10000,
        parallelRequests: summaryConfig?.parallel_requests ?? 2,
        maxRetries: summaryConfig?.max_retries,
        timeoutMs: summaryConfig?.timeout_ms,
      },
      onProgress: this.options.onProgress,
    });

    const metadata = await pipeline.run();

    // 索引完成后初始化项目 memory（首次）
    this.initMemoryIfNeeded(dirPath, metadata);

    // 更新 registry
    this.updateRegistry(metadata);

    // 清理
    await invertedIndex.close();
    await vectorStore.close();
    await embeddingService.dispose();

    return metadata;
  }

  private initMemoryIfNeeded(dirPath: string, metadata: IndexMetadata): void {
    const memoryDir = join(dirPath, '.fs_index', 'memory');
    const projectMdPath = join(memoryDir, 'project.md');

    if (existsSync(projectMdPath)) {
      return;
    }

    const directorySummary = metadata.directorySummary?.trim();
    if (!directorySummary) {
      return;
    }

    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(join(memoryDir, 'extend'), { recursive: true });

    const projectName = basename(metadata.directoryPath) || 'Project';
    const initialProjectMd = `# ${projectName}\n\n${directorySummary}\n`;
    writeFileSync(projectMdPath, initialProjectMd);
  }

  private updateRegistry(metadata: IndexMetadata): void {
    const registryPath = join(homedir(), '.agent_fs', 'registry.json');

    let registry = this.createEmptyRegistry();
    if (existsSync(registryPath)) {
      try {
        const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as unknown;
        registry = this.parseRegistryOrEmpty(parsed);
      } catch {
        registry = this.createEmptyRegistry();
      }
    }

    // 更新或添加项目
    const existing = registry.projects.find((project) => project.path === metadata.directoryPath);
    const projectSubdirectories = this.collectSubdirectoryRefs(metadata.directoryPath);

    if (existing) {
      existing.projectId = metadata.projectId;
      existing.summary = metadata.directorySummary;
      existing.lastUpdated = metadata.updatedAt;
      existing.totalFileCount = metadata.stats.fileCount;
      existing.totalChunkCount = metadata.stats.chunkCount;
      existing.subdirectories = projectSubdirectories;
      existing.valid = true;
    } else {
      registry.projects.push({
        path: metadata.directoryPath,
        alias: metadata.directoryPath.split('/').pop() || '',
        projectId: metadata.projectId,
        summary: metadata.directorySummary,
        lastUpdated: metadata.updatedAt,
        totalFileCount: metadata.stats.fileCount,
        totalChunkCount: metadata.stats.chunkCount,
        subdirectories: projectSubdirectories,
        valid: true,
      });
    }

    mkdirSync(join(homedir(), '.agent_fs'), { recursive: true });
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  }

  private createEmptyRegistry(): Registry {
    return {
      version: '2.0',
      embeddingModel: this.config.embedding.local?.model || this.config.embedding.api?.model || '',
      embeddingDimension: 512,
      projects: [],
    };
  }

  private parseRegistryOrEmpty(registryData: unknown): Registry {
    const registryRecord = this.toRecord(registryData);
    if (!registryRecord) {
      return this.createEmptyRegistry();
    }

    const projectsRaw = registryRecord.projects;
    if (!Array.isArray(projectsRaw)) {
      return this.createEmptyRegistry();
    }

    return registryRecord as unknown as Registry;
  }

  private collectSubdirectoryRefs(
    projectPath: string
  ): Registry['projects'][number]['subdirectories'] {
    const rootMetadata = this.readIndexMetadata(projectPath);
    if (!rootMetadata) {
      return [];
    }

    const refs: Registry['projects'][number]['subdirectories'] = [];
    const stack: IndexMetadata[] = [rootMetadata];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      for (const subdirectory of current.subdirectories) {
        const childDirPath = join(current.directoryPath, subdirectory.name);
        const childMetadata = this.readIndexMetadata(childDirPath);
        if (!childMetadata) {
          continue;
        }

        refs.push({
          relativePath: childMetadata.relativePath,
          dirId: childMetadata.dirId,
          fileCount: childMetadata.stats.fileCount,
          chunkCount: childMetadata.stats.chunkCount,
          lastUpdated: childMetadata.updatedAt,
        });
        stack.push(childMetadata);
      }
    }

    return refs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  private readIndexMetadata(dirPath: string): IndexMetadata | null {
    const indexPath = join(dirPath, '.fs_index', 'index.json');
    if (!existsSync(indexPath)) {
      return null;
    }

    return JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadata;
  }

  async dispose(): Promise<void> {
    await this.pluginManager.disposeAll();
  }

  private resolvePluginOptions(): {
    pdf: ConstructorParameters<typeof PDFPlugin>[0];
    docx: ConstructorParameters<typeof DocxPlugin>[0];
    excel: ConstructorParameters<typeof ExcelPlugin>[0];
  } {
    const plugins = this.toRecord(this.config.plugins);

    return {
      pdf: this.resolvePdfPluginOptions(this.toRecord(plugins?.pdf)),
      docx: this.resolveDocxPluginOptions(this.toRecord(plugins?.docx)),
      excel: this.resolveExcelPluginOptions(this.toRecord(plugins?.excel)),
    };
  }

  private resolvePdfPluginOptions(
    raw: Record<string, unknown> | null
  ): ConstructorParameters<typeof PDFPlugin>[0] {
    const minerURaw = raw ? this.toRecord(raw.minerU) : null;
    if (!minerURaw) return {};

    const normalizedMinerU: Record<string, unknown> = { ...minerURaw };
    const serverUrl = this.pickFirstString(minerURaw, ['serverUrl', 'server_url', 'apiHost', 'api_host']);
    if (serverUrl) {
      normalizedMinerU.serverUrl = serverUrl;
      delete normalizedMinerU.server_url;
      delete normalizedMinerU.apiHost;
      delete normalizedMinerU.api_host;
    }

    return {
      minerU: normalizedMinerU as any,
    };
  }

  private resolveDocxPluginOptions(
    raw: Record<string, unknown> | null
  ): ConstructorParameters<typeof DocxPlugin>[0] {
    const converterRaw = raw ? this.toRecord(raw.converter) : null;
    if (!converterRaw) return {};
    return {
      converter: converterRaw as any,
    };
  }

  private resolveExcelPluginOptions(
    raw: Record<string, unknown> | null
  ): ConstructorParameters<typeof ExcelPlugin>[0] {
    const converterRaw = raw ? this.toRecord(raw.converter) : null;
    if (!converterRaw) return {};
    return {
      converter: converterRaw as any,
    };
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private pickFirstString(
    source: Record<string, unknown>,
    keys: string[]
  ): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return null;
  }
}

export function createIndexer(options?: IndexerOptions): Indexer {
  return new Indexer(options);
}
