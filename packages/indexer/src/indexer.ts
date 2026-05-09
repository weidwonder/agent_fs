import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { Registry, IndexMetadata, Config, FileMetadata } from '@agent-fs/core';
import { loadConfig, MarkdownChunker } from '@agent-fs/core';
import { createEmbeddingService, createSummaryService } from '@agent-fs/llm';
import { createLocalAdapter, LocalArchiveAdapter } from '@agent-fs/storage-adapter';
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
  runtimeVersion?: string;
}

interface MetadataTreeNode {
  dirPath: string;
  metadata: IndexMetadata;
  children: MetadataTreeNode[];
}

interface FileBackfillResult {
  documentSummaryUpdated: boolean;
}

export class Indexer {
  private config: Config;
  private pluginManager: PluginManager;
  private options: IndexerOptions;
  private readonly runtimeVersion: string;
  private backfillLogFilePath = '';

  constructor(options: IndexerOptions = {}) {
    this.options = options;
    this.config = loadConfig({ configPath: options.configPath });
    this.runtimeVersion = options.runtimeVersion?.trim() || 'unknown';
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

    const summaryService = createSummaryService(this.config.llm, {
      maxConcurrentRequests: this.config.summary?.parallel_requests,
    });

    const storage = createLocalAdapter({
      storagePath,
      dimension: embeddingService.getDimension(),
    });
    await storage.init();

    const archiveByDir = new Map<string, LocalArchiveAdapter>();
    const archiveResolver = (targetDirPath: string): LocalArchiveAdapter => {
      const cached = archiveByDir.get(targetDirPath);
      if (cached) {
        return cached;
      }

      const afdStorage = createAFDStorage({
        documentsDir: join(targetDirPath, '.fs_index', 'documents'),
      });
      const adapter = new LocalArchiveAdapter(afdStorage);
      archiveByDir.set(targetDirPath, adapter);
      return adapter;
    };

    // 运行流水线
    const chunkSize = this.config.indexing.chunk_size;
    const summaryConfig = this.config.summary;
    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: this.pluginManager,
      embeddingService,
      summaryService,
      storage,
      archiveResolver,
      chunkOptions: {
        minTokens: chunkSize.min_tokens,
        maxTokens: chunkSize.max_tokens,
      },
      fileParallelism: this.config.indexing.file_parallelism ?? 2,
      summaryOptions: {
        mode: summaryConfig?.mode ?? 'batch',
        maxRetries: summaryConfig?.max_retries,
        timeoutMs: summaryConfig?.timeout_ms,
      },
      clueConfig: this.config.clue,
      indexerVersion: this.runtimeVersion,
      onProgress: this.options.onProgress,
    });

    let metadata: IndexMetadata;
    try {
      metadata = await pipeline.run();
    } catch (error) {
      const detail = (error as Error).message;
      const logPath = pipeline.getLogFilePath();
      if (logPath) {
        throw new Error(`${detail}\n日志: ${logPath}`);
      }
      throw error;
    }

    // 索引完成后初始化项目 memory（首次）
    this.initMemoryIfNeeded(dirPath, metadata);

    // 更新 registry
    this.updateRegistry(metadata);

    // 清理
    await storage.close();
    await embeddingService.dispose();

    return metadata;
  }

  async backfillSummaries(dirPath: string): Promise<IndexMetadata> {
    const rootTree = this.loadMetadataTree(dirPath);
    if (!rootTree) {
      throw new Error(`未找到索引元数据，请先执行索引：${dirPath}`);
    }
    this.initBackfillLogFile(dirPath);
    const backfillStartedAt = Date.now();

    const summaryService = createSummaryService(this.config.llm, {
      maxConcurrentRequests: this.config.summary?.parallel_requests,
    });

    const summaryConfig = this.config.summary;
    const summaryOptions = {
      maxRetries: summaryConfig?.max_retries,
      timeoutMs: summaryConfig?.timeout_ms,
    };
    const backfillFileParallelism = Math.max(1, this.config.indexing.file_parallelism ?? 2);

    const chunker = new MarkdownChunker({
      minTokens: this.config.indexing.chunk_size.min_tokens,
      maxTokens: this.config.indexing.chunk_size.max_tokens,
    });

    const allNodes = this.flattenMetadataTree(rootTree);
    const totalFiles = allNodes.reduce((sum, node) => sum + node.metadata.files.length, 0);
    let processedFiles = 0;
    let startedFiles = 0;
    const stats = {
      filesProcessed: 0,
      documentSummariesGenerated: 0,
      directorySummariesGenerated: 0,
    };
    this.writeBackfillLog({
      level: 'info',
      event: 'backfill_start',
      directory: dirPath,
      totalDirectories: allNodes.length,
      totalFiles,
      runtimeVersion: this.runtimeVersion,
      fileParallelism: backfillFileParallelism,
    });

    const sortedByDepth = [...allNodes].sort(
      (left, right) =>
        this.depthFromRelativePath(right.metadata.relativePath) -
        this.depthFromRelativePath(left.metadata.relativePath)
    );
    const nodeByRelativePath = new Map(
      sortedByDepth.map((node) => [node.metadata.relativePath, node])
    );

    try {
      for (const node of sortedByDepth) {
        const storage = createAFDStorage({
          documentsDir: join(node.dirPath, '.fs_index', 'documents'),
        });

        await this.runWithConcurrency(
          node.metadata.files,
          backfillFileParallelism,
          async (file) => {
            const filePathForLog = this.toRelativeFilePath(node.metadata.relativePath, file.name);
            startedFiles += 1;
            const startedOrder = startedFiles;
            const progressSnapshot = processedFiles;
            this.writeBackfillLog({
              level: 'info',
              event: 'file_start',
              file: filePathForLog,
              processed: startedOrder,
              total: totalFiles,
            });
            this.options.onProgress?.({
              phase: 'summary',
              currentFile: filePathForLog,
              processed: progressSnapshot,
              total: totalFiles,
            });

            try {
              const result = await this.backfillFileSummary({
                node,
                file,
                processed: progressSnapshot,
                getProcessedCount: () => processedFiles,
                total: totalFiles,
                storage,
                chunker,
                summaryService,
                summaryOptions,
              });
              stats.filesProcessed += 1;
              if (result.documentSummaryUpdated) {
                stats.documentSummariesGenerated += 1;
              }

              if (result.documentSummaryUpdated) {
                file.indexedAt = new Date().toISOString();
              }

              processedFiles += 1;
              this.options.onProgress?.({
                phase: 'write',
                currentFile: filePathForLog,
                processed: processedFiles,
                total: totalFiles,
              });
              this.writeBackfillLog({
                level: 'info',
                event: 'file_done',
                file: filePathForLog,
                processed: processedFiles,
                total: totalFiles,
                documentSummaryUpdated: result.documentSummaryUpdated,
              });
            } catch (error) {
              this.writeBackfillLog({
                level: 'error',
                event: 'file_error',
                file: filePathForLog,
                detail: this.extractErrorMessage(error),
              });
              throw error;
            }
          }
        );

        const previousSummary = node.metadata.directorySummary ?? '';
        if (!previousSummary.trim()) {
          const fileSummaries = node.metadata.files.map((file) => `${file.name}: ${file.summary}`);
          const subdirectorySummaries = node.metadata.subdirectories
            .map((subdirectory) => {
              const childRelativePath =
                node.metadata.relativePath === '.'
                  ? subdirectory.name
                  : `${node.metadata.relativePath}/${subdirectory.name}`;
              return nodeByRelativePath.get(childRelativePath)?.metadata.directorySummary ?? '';
            })
            .filter((summary) => summary.trim().length > 0);

          const generated = await summaryService.generateDirectorySummary(
            node.metadata.directoryPath,
            fileSummaries,
            subdirectorySummaries,
            {
              maxRetries: summaryOptions.maxRetries,
              timeoutMs: summaryOptions.timeoutMs,
            }
          );
          node.metadata.directorySummary = generated.summary;
          if (generated.summary.trim().length > 0) {
            stats.directorySummariesGenerated += 1;
          }
          this.writeBackfillLog({
            level: 'info',
            event: 'directory_summary_done',
            directory: node.metadata.relativePath,
            generated: generated.summary.trim().length > 0,
          });
        }

        this.refreshDirectoryAggregates(node, nodeByRelativePath);
        node.metadata.updatedAt = new Date().toISOString();
        node.metadata.indexedWithVersion = this.runtimeVersion;
        this.writeDirectoryMetadata(node.dirPath, node.metadata);
      }
      this.writeBackfillLog({
        level: 'info',
        event: 'backfill_success',
        totalFiles,
        durationMs: Date.now() - backfillStartedAt,
        ...stats,
      });
    } catch (error) {
      this.writeBackfillLog({
        level: 'error',
        event: 'backfill_error',
        durationMs: Date.now() - backfillStartedAt,
        detail: this.extractErrorMessage(error),
      });
      throw error;
    }

    const rootMetadata = this.readIndexMetadata(dirPath);
    if (!rootMetadata) {
      throw new Error('补全摘要后读取根索引失败');
    }

    this.initMemoryIfNeeded(dirPath, rootMetadata);
    this.updateRegistry(rootMetadata);
    return rootMetadata;
  }

  private initBackfillLogFile(dirPath: string): void {
    const logsDir = join(dirPath, '.fs_index', 'logs');
    mkdirSync(logsDir, { recursive: true });
    this.backfillLogFilePath = join(logsDir, 'summary-backfill.latest.jsonl');
    writeFileSync(this.backfillLogFilePath, '');
  }

  private writeBackfillLog(entry: Record<string, unknown>): void {
    if (!this.backfillLogFilePath) {
      return;
    }

    try {
      const payload = JSON.stringify({
        timestamp: new Date().toISOString(),
        ...entry,
      });
      appendFileSync(this.backfillLogFilePath, `${payload}\n`);
    } catch {
      // 日志写入失败不应影响主流程
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message?.trim();
      if (message) {
        return message;
      }
    }
    return '未提供错误详情';
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

  private writeDirectoryMetadata(dirPath: string, metadata: IndexMetadata): void {
    writeFileSync(join(dirPath, '.fs_index', 'index.json'), JSON.stringify(metadata, null, 2));
  }

  private loadMetadataTree(dirPath: string): MetadataTreeNode | null {
    const metadata = this.readIndexMetadata(dirPath);
    if (!metadata) {
      return null;
    }

    const children: MetadataTreeNode[] = [];
    for (const subdirectory of metadata.subdirectories) {
      const childPath = join(dirPath, subdirectory.name);
      const childTree = this.loadMetadataTree(childPath);
      if (childTree) {
        children.push(childTree);
      }
    }

    return {
      dirPath,
      metadata,
      children,
    };
  }

  private flattenMetadataTree(root: MetadataTreeNode): MetadataTreeNode[] {
    const result: MetadataTreeNode[] = [];
    const stack: MetadataTreeNode[] = [root];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      result.push(current);
      for (const child of current.children) {
        stack.push(child);
      }
    }

    return result;
  }

  private depthFromRelativePath(relativePath: string): number {
    if (!relativePath || relativePath === '.') {
      return 0;
    }
    return relativePath.split('/').length;
  }

  private toRelativeFilePath(relativePath: string, filename: string): string {
    return relativePath === '.' ? filename : `${relativePath}/${filename}`;
  }

  private async backfillFileSummary(input: {
    node: MetadataTreeNode;
    file: FileMetadata;
    processed: number;
    getProcessedCount: () => number;
    total: number;
    storage: ReturnType<typeof createAFDStorage>;
    chunker: MarkdownChunker;
    summaryService: ReturnType<typeof createSummaryService>;
    summaryOptions: {
      maxRetries?: number;
      timeoutMs?: number;
    };
  }): Promise<FileBackfillResult> {
    const archiveName = input.file.afdName ?? input.file.name ?? input.file.fileId;
    let markdown = '';
    try {
      markdown = await input.storage.readText(archiveName, 'content.md');
    } catch (error) {
      throw new Error(`读取 AFD 内容失败: ${archiveName} - ${(error as Error).message}`);
    }

    let metadataJson = '{}';
    try {
      metadataJson = await input.storage.readText(archiveName, 'metadata.json');
    } catch {
      metadataJson = '{}';
    }

    let storedDocumentSummary = '';
    let hasLegacyChunkSummaries = false;
    try {
      const summaryBuffer = await input.storage.read(archiveName, 'summaries.json');
      const parsed = JSON.parse(summaryBuffer.toString('utf-8')) as Record<string, unknown>;
      if (typeof parsed.documentSummary === 'string') {
        storedDocumentSummary = parsed.documentSummary;
      }
      hasLegacyChunkSummaries = Object.keys(parsed).some((key) => key !== 'documentSummary');
    } catch {
      storedDocumentSummary = '';
      hasLegacyChunkSummaries = false;
    }

    this.options.onProgress?.({
      phase: 'chunk',
      currentFile: this.toRelativeFilePath(input.node.metadata.relativePath, input.file.name),
      processed: Math.max(input.processed, input.getProcessedCount()),
      total: input.total,
    });
    const chunks = input.chunker.chunk(markdown);
    const chunkIds = chunks.map(
      (_, index) => `${input.file.fileId}:${String(index).padStart(4, '0')}`
    );
    if (chunkIds.length !== input.file.chunkCount) {
      throw new Error(
        `文件 chunk 数发生变化（${input.file.name}: ${input.file.chunkCount} -> ${chunkIds.length}），请使用重新索引`
      );
    }

    const metadataSummary = input.file.summary?.trim() ?? '';
    let nextDocumentSummary = metadataSummary || storedDocumentSummary;
    let documentSummaryUpdated = false;

    if (!nextDocumentSummary.trim()) {
      this.options.onProgress?.({
        phase: 'summary',
        currentFile: this.toRelativeFilePath(input.node.metadata.relativePath, input.file.name),
        processed: Math.max(input.processed, input.getProcessedCount()),
        total: input.total,
      });

      const docSummary = await input.summaryService.generateDocumentSummary(
        this.toRelativeFilePath(input.node.metadata.relativePath, input.file.name),
        markdown,
        {
          maxRetries: input.summaryOptions.maxRetries,
          timeoutMs: input.summaryOptions.timeoutMs,
        }
      );
      nextDocumentSummary = docSummary.summary;
      if (docSummary.summary.trim().length > 0) {
        documentSummaryUpdated = true;
      }
    } else if (metadataSummary !== nextDocumentSummary) {
      documentSummaryUpdated = true;
    }

    if (input.file.summary !== nextDocumentSummary) {
      input.file.summary = nextDocumentSummary;
      documentSummaryUpdated = true;
    }

    const shouldRewriteSummaries =
      hasLegacyChunkSummaries || storedDocumentSummary !== nextDocumentSummary;

    if (shouldRewriteSummaries) {
      this.options.onProgress?.({
        phase: 'write',
        currentFile: this.toRelativeFilePath(input.node.metadata.relativePath, input.file.name),
        processed: Math.max(input.processed, input.getProcessedCount()),
        total: input.total,
      });
      await input.storage.write(archiveName, {
        'content.md': markdown,
        'metadata.json': metadataJson,
        'summaries.json': JSON.stringify({ documentSummary: nextDocumentSummary }, null, 2),
      });
    }

    return {
      documentSummaryUpdated,
    };
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
    let nextIndex = 0;

    const runners = Array.from({ length: workerCount }).map(async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        if (item === undefined) {
          continue;
        }
        await worker(item, currentIndex);
      }
    });

    await Promise.all(runners);
  }

  private refreshDirectoryAggregates(
    node: MetadataTreeNode,
    nodeByRelativePath: Map<string, MetadataTreeNode>
  ): void {
    const ownFileCount = node.metadata.files.length;
    const ownChunkCount = node.metadata.files.reduce((sum, file) => sum + file.chunkCount, 0);

    let childFileCount = 0;
    let childChunkCount = 0;
    let childTokenCount = 0;

    node.metadata.subdirectories = node.metadata.subdirectories.map((subdirectory) => {
      const childRelativePath =
        node.metadata.relativePath === '.'
          ? subdirectory.name
          : `${node.metadata.relativePath}/${subdirectory.name}`;
      const child = nodeByRelativePath.get(childRelativePath);
      if (!child) {
        return subdirectory;
      }

      childFileCount += child.metadata.stats.fileCount;
      childChunkCount += child.metadata.stats.chunkCount;
      childTokenCount += child.metadata.stats.totalTokens;

      return {
        ...subdirectory,
        summary: child.metadata.directorySummary || null,
        fileCount: child.metadata.stats.fileCount,
        lastUpdated: child.metadata.updatedAt,
        fileIds: this.collectDirectoryFileIds(child.metadata),
        fileArchives: this.collectDirectoryFileArchives(child.metadata),
      };
    });

    node.metadata.stats.fileCount = ownFileCount + childFileCount;
    node.metadata.stats.chunkCount = ownChunkCount + childChunkCount;
    node.metadata.stats.totalTokens = ownChunkCount * 800 + childTokenCount;
  }

  private collectDirectoryFileIds(metadata: IndexMetadata): string[] {
    const ownFileIds = metadata.files.map((file) => file.fileId);
    const childFileIds = metadata.subdirectories.flatMap(
      (subdirectory) => subdirectory.fileIds ?? []
    );
    return Array.from(new Set([...ownFileIds, ...childFileIds]));
  }

  private collectDirectoryFileArchives(
    metadata: IndexMetadata
  ): Array<{ fileId: string; afdName: string }> {
    const ownArchives = metadata.files.map((file) => ({
      fileId: file.fileId,
      afdName: file.afdName ?? file.name ?? file.fileId,
    }));
    const childArchives = metadata.subdirectories.flatMap(
      (subdirectory) => subdirectory.fileArchives ?? []
    );

    const merged = new Map<string, string>();
    for (const item of [...ownArchives, ...childArchives]) {
      if (!merged.has(item.fileId)) {
        merged.set(item.fileId, item.afdName);
      }
    }

    return [...merged.entries()].map(([fileId, afdName]) => ({ fileId, afdName }));
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
    const textExtractionRaw = raw
      ? this.toRecord(raw.textExtraction) ?? this.toRecord(raw.text_extraction)
      : null;
    const minerURaw = raw ? this.toRecord(raw.minerU) : null;
    const resolvedOptions: ConstructorParameters<typeof PDFPlugin>[0] = {};

    if (textExtractionRaw) {
      const normalizedTextExtraction: Record<string, unknown> = {
        ...textExtractionRaw,
      };
      const minTextCharsPerPage = this.pickFirstNumber(textExtractionRaw, [
        'minTextCharsPerPage',
        'min_text_chars_per_page',
      ]);

      if (minTextCharsPerPage !== null) {
        normalizedTextExtraction.minTextCharsPerPage = Math.max(
          0,
          Math.floor(minTextCharsPerPage)
        );
        delete normalizedTextExtraction.min_text_chars_per_page;
      }

      if (typeof textExtractionRaw.enabled === 'boolean') {
        normalizedTextExtraction.enabled = textExtractionRaw.enabled;
      }

      resolvedOptions.textExtraction = normalizedTextExtraction as any;
    }

    if (!minerURaw) return resolvedOptions;

    const normalizedMinerU: Record<string, unknown> = { ...minerURaw };
    const serverUrl = this.pickFirstString(minerURaw, [
      'serverUrl',
      'server_url',
      'apiHost',
      'api_host',
    ]);
    if (serverUrl) {
      normalizedMinerU.serverUrl = serverUrl;
      delete normalizedMinerU.server_url;
      delete normalizedMinerU.apiHost;
      delete normalizedMinerU.api_host;
    }

    const maxConcurrency = normalizedMinerU.maxConcurrency;
    if (
      typeof maxConcurrency !== 'number' ||
      !Number.isFinite(maxConcurrency) ||
      maxConcurrency < 1
    ) {
      normalizedMinerU.maxConcurrency = 4;
    }

    const pageConcurrency = normalizedMinerU.pageConcurrency;
    if (
      typeof pageConcurrency !== 'number' ||
      !Number.isFinite(pageConcurrency) ||
      pageConcurrency < 1
    ) {
      normalizedMinerU.pageConcurrency = 2;
    }

    const cropImageFormat = normalizedMinerU.cropImageFormat;
    if (cropImageFormat !== 'jpeg' && cropImageFormat !== 'png') {
      normalizedMinerU.cropImageFormat = 'png';
    }

    return {
      ...resolvedOptions,
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

  private pickFirstString(source: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return null;
  }

  private pickFirstNumber(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  }
}

export function createIndexer(options?: IndexerOptions): Indexer {
  return new Indexer(options);
}
