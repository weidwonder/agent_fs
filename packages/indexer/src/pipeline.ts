import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  ChunkMetadata,
  DocumentConversionResult,
  FileMetadata,
  IndexMetadata,
  SubdirectoryInfo,
  SummaryMode,
  VectorDocument,
} from '@agent-fs/core';
import { MarkdownChunker } from '@agent-fs/core';
import type { EmbeddingService, SummaryService } from '@agent-fs/llm';
import type { IndexEntry, InvertedIndex, VectorStore } from '@agent-fs/search';
import type { AFDStorage } from '@agent-fs/storage';
import { FileChecker } from './file-checker';
import type { PluginManager } from './plugin-manager';
import { scanDirectory, type ScanResult } from './scanner';

export interface IndexProgress {
  phase: 'scan' | 'convert' | 'chunk' | 'summary' | 'embed' | 'write';
  currentFile: string;
  processed: number;
  total: number;
}

export interface IndexerOptions {
  dirPath: string;
  pluginManager: PluginManager;
  embeddingService: EmbeddingService;
  summaryService: SummaryService;
  vectorStore: VectorStore;
  invertedIndex: InvertedIndex;
  afdStorage: AFDStorage;
  afdStorageResolver?: (dirPath: string) => AFDStorage;
  fileParallelism?: number;
  chunkOptions: { minTokens: number; maxTokens: number };
  summaryOptions: SummaryPipelineOptions;
  onProgress?: (progress: IndexProgress) => void;
}

export interface SummaryPipelineOptions {
  mode: SummaryMode;
  tokenBudget: number;
  parallelRequests?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

interface DirectoryContext {
  dirPath: string;
  relativePath: string;
  dirId: string;
  parentDirId: string | null;
  scanResult: ScanResult;
  children: DirectoryContext[];
}

interface DirectoryRunResult {
  metadata: IndexMetadata;
  totalFileCount: number;
  totalChunkCount: number;
  totalTokens: number;
}

interface ProcessFileInput {
  dirPath: string;
  filePath: string;
  relativeFilePath: string;
  displayName: string;
  afdName: string;
  dirId: string;
  fileId: string;
  fileHash: string;
  processed: number;
  total: number;
}

export class IndexPipeline {
  private readonly options: IndexerOptions;
  private projectId: string;
  private existingMetadataByRelativePath = new Map<string, IndexMetadata>();
  private existingFileArchiveById = new Map<string, { dirPath: string; archiveName: string }>();
  private processedFiles = 0;
  private totalFiles = 0;
  private readonly fileChecker = new FileChecker();

  constructor(options: IndexerOptions) {
    this.options = options;
    this.projectId = uuidv4();
  }

  async run(): Promise<IndexMetadata> {
    const { dirPath } = this.options;

    // 确保根目录索引目录存在
    mkdirSync(join(dirPath, '.fs_index'), { recursive: true });

    this.existingMetadataByRelativePath = this.loadExistingMetadataMap(dirPath);
    this.existingFileArchiveById = this.buildExistingFileArchiveMap(
      this.existingMetadataByRelativePath
    );
    const existingRoot = this.existingMetadataByRelativePath.get('.');
    this.projectId = existingRoot?.projectId ?? uuidv4();
    const rootDirId = existingRoot?.dirId ?? this.projectId;

    const tree = this.scanDirectoryTree(
      dirPath,
      '.',
      null,
      rootDirId,
      this.existingMetadataByRelativePath
    );
    this.totalFiles = this.countSupportedFiles(tree);

    const result = await this.indexDirectoryTree(tree);
    return result.metadata;
  }

  private scanDirectoryTree(
    dirPath: string,
    relativePath: string,
    parentDirId: string | null,
    dirId: string,
    existingMap: Map<string, IndexMetadata>
  ): DirectoryContext {
    const extensions = this.options.pluginManager.getSupportedExtensions();
    const scanResult = scanDirectory(dirPath, extensions);

    const children = scanResult.subdirectories.map((name) => {
      const childPath = join(dirPath, name);
      const childRelativePath = relativePath === '.' ? name : `${relativePath}/${name}`;
      const childDirId = existingMap.get(childRelativePath)?.dirId ?? uuidv4();
      return this.scanDirectoryTree(childPath, childRelativePath, dirId, childDirId, existingMap);
    });

    return {
      dirPath,
      relativePath,
      dirId,
      parentDirId,
      scanResult,
      children,
    };
  }

  private countSupportedFiles(context: DirectoryContext): number {
    return (
      context.scanResult.supportedFiles.length +
      context.children.reduce((sum, child) => sum + this.countSupportedFiles(child), 0)
    );
  }

  private loadExistingMetadataMap(rootDirPath: string): Map<string, IndexMetadata> {
    const map = new Map<string, IndexMetadata>();
    const rootMetadata = this.readIndexMetadata(rootDirPath);
    if (!rootMetadata) {
      return map;
    }

    const stack: IndexMetadata[] = [rootMetadata];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      map.set(current.relativePath, current);
      for (const subdirectory of current.subdirectories) {
        const childPath = join(current.directoryPath, subdirectory.name);
        const childMetadata = this.readIndexMetadata(childPath);
        if (childMetadata) {
          stack.push(childMetadata);
        }
      }
    }

    return map;
  }

  private readIndexMetadata(dirPath: string): IndexMetadata | null {
    const indexPath = join(dirPath, '.fs_index', 'index.json');
    if (!existsSync(indexPath)) {
      return null;
    }

    return JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadata;
  }

  private async indexDirectoryTree(context: DirectoryContext): Promise<DirectoryRunResult> {
    const summaryOptions = this.options.summaryOptions ?? {
      mode: 'batch',
      tokenBudget: 10000,
    };

    const previousMetadata = this.existingMetadataByRelativePath.get(context.relativePath);
    const previousFilesByName = new Map(
      (previousMetadata?.files ?? []).map((file) => [file.name, file])
    );

    const ownFilesByIndex: FileMetadata[] = [];
    let ownChunks = 0;
    let ownTokens = 0;
    const filenames = context.scanResult.supportedFiles;
    const currentFileNames = new Set(filenames);
    const fileWorkerCount = Math.min(this.getFileParallelism(), filenames.length);
    let nextFileIndex = 0;

    const workers = Array.from({ length: fileWorkerCount }).map(async () => {
      while (nextFileIndex < filenames.length) {
        const fileIndex = nextFileIndex;
        nextFileIndex += 1;

        const filename = filenames[fileIndex];
        if (!filename) {
          continue;
        }

        const filePath = join(context.dirPath, filename);
        const relativeFilePath =
          context.relativePath === '.' ? filename : `${context.relativePath}/${filename}`;
        const previousFile = previousFilesByName.get(filename);
        const fileProgress = this.reserveProcessedFile();
        const hashResult = await this.fileChecker.checkFileChanged(filePath, {
          hash: previousFile?.hash ?? '',
        });

        if (previousFile && !hashResult.changed) {
          ownFilesByIndex[fileIndex] = previousFile;
          continue;
        }

        if (previousFile) {
          await this.cleanupFileArtifacts(
            previousFile.fileId,
            context.dirPath,
            previousFile.afdName ?? previousFile.name ?? previousFile.fileId
          );
        }

        const fileId = previousFile?.fileId ?? this.createFileId(relativeFilePath);
        ownFilesByIndex[fileIndex] = await this.processFile({
          dirPath: context.dirPath,
          filePath,
          relativeFilePath,
          displayName: filename,
          afdName: previousFile?.afdName ?? filename,
          dirId: context.dirId,
          fileId,
          fileHash: hashResult.hash,
          processed: fileProgress,
          total: this.totalFiles,
        });
      }
    });

    await Promise.all(workers);

    const ownFiles = ownFilesByIndex.filter((file): file is FileMetadata => Boolean(file));
    for (const file of ownFiles) {
      ownChunks += file.chunkCount;
      ownTokens += file.chunkCount * 800; // 粗略估算
    }

    const removedFileCandidates = previousMetadata?.files ?? [];
    for (const removedFile of removedFileCandidates) {
      if (currentFileNames.has(removedFile.name)) {
        continue;
      }
      await this.cleanupFileArtifacts(
        removedFile.fileId,
        context.dirPath,
        removedFile.afdName ?? removedFile.name ?? removedFile.fileId
      );
    }

    const childResults: DirectoryRunResult[] = [];
    const currentSubdirectoryNames = new Set(context.children.map((child) => basename(child.dirPath)));
    for (const child of context.children) {
      childResults.push(await this.indexDirectoryTree(child));
    }

    for (const oldSubdirectory of previousMetadata?.subdirectories ?? []) {
      if (currentSubdirectoryNames.has(oldSubdirectory.name)) {
        continue;
      }

      await this.cleanupRemovedDirectory(oldSubdirectory, join(context.dirPath, oldSubdirectory.name));
    }

    const childFileCount = childResults.reduce((sum, child) => sum + child.totalFileCount, 0);
    const childChunkCount = childResults.reduce((sum, child) => sum + child.totalChunkCount, 0);
    const childTokenCount = childResults.reduce((sum, child) => sum + child.totalTokens, 0);

    let directorySummary = '';
    if (summaryOptions.mode !== 'skip') {
      const fileSummaries = ownFiles.map((file) => `${file.name}: ${file.summary}`);
      const subdirectorySummaries = childResults
        .map((child) => child.metadata.directorySummary)
        .filter((summary) => summary.length > 0);
      const dirSummaryResult = await this.options.summaryService.generateDirectorySummary(
        context.dirPath,
        fileSummaries,
        subdirectorySummaries,
        {
          maxRetries: summaryOptions.maxRetries,
          timeoutMs: summaryOptions.timeoutMs,
        }
      );
      directorySummary = dirSummaryResult.summary;
    }

    const now = new Date().toISOString();
    const metadata: IndexMetadata = {
      version: '2.0',
      createdAt: now,
      updatedAt: now,
      dirId: context.dirId,
      directoryPath: context.dirPath,
      directorySummary,
      projectId: this.projectId,
      relativePath: context.relativePath,
      parentDirId: context.parentDirId,
      stats: {
        fileCount: ownFiles.length + childFileCount,
        chunkCount: ownChunks + childChunkCount,
        totalTokens: ownTokens + childTokenCount,
      },
      files: ownFiles,
      subdirectories: childResults.map((child) => ({
        name: basename(child.metadata.directoryPath),
        dirId: child.metadata.dirId,
        hasIndex: true,
        summary: child.metadata.directorySummary || null,
        fileCount: child.totalFileCount,
        lastUpdated: child.metadata.updatedAt,
        fileIds: this.collectDirectoryFileIds(child.metadata),
        fileArchives: this.collectDirectoryFileArchives(child.metadata),
      })),
      unsupportedFiles: context.scanResult.unsupportedFiles,
    };

    this.writeDirectoryMetadata(context.dirPath, metadata);

    return {
      metadata,
      totalFileCount: metadata.stats.fileCount,
      totalChunkCount: metadata.stats.chunkCount,
      totalTokens: metadata.stats.totalTokens,
    };
  }

  private writeDirectoryMetadata(dirPath: string, metadata: IndexMetadata): void {
    const fsIndexPath = join(dirPath, '.fs_index');
    mkdirSync(fsIndexPath, { recursive: true });
    writeFileSync(join(fsIndexPath, 'index.json'), JSON.stringify(metadata, null, 2));
  }

  private createFileId(relativeFilePath: string): string {
    return createHash('sha256')
      .update(`${this.projectId}:${relativeFilePath}`)
      .digest('hex')
      .slice(0, 16);
  }

  private collectDirectoryFileIds(metadata: IndexMetadata): string[] {
    const ownFileIds = metadata.files.map((file) => file.fileId);
    const childFileIds = metadata.subdirectories.flatMap((subdirectory) => subdirectory.fileIds ?? []);
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

  private async cleanupFileArtifacts(
    fileId: string,
    dirPath: string,
    archiveName: string
  ): Promise<void> {
    await this.options.vectorStore.deleteByFileId(fileId);
    await this.options.invertedIndex.removeFile(fileId);
    await this.deleteAfdFile(dirPath, archiveName);
  }

  private async cleanupRemovedDirectory(
    subdirectory: SubdirectoryInfo,
    dirPath: string
  ): Promise<void> {
    const metadata = this.readIndexMetadata(dirPath);
    if (metadata) {
      for (const file of metadata.files) {
        await this.deleteAfdFile(
          metadata.directoryPath,
          file.afdName ?? file.name ?? file.fileId
        );
      }

      for (const childSubdirectory of metadata.subdirectories) {
        const childPath = join(metadata.directoryPath, childSubdirectory.name);
        await this.cleanupRemovedDirectory(childSubdirectory, childPath);
      }
    } else {
      const fallbackArchives = new Map(
        (subdirectory.fileArchives ?? []).map((item) => [item.fileId, item.afdName])
      );

      for (const fileId of subdirectory.fileIds ?? []) {
        const archivedName = fallbackArchives.get(fileId);
        if (archivedName) {
          await this.deleteAfdFile(dirPath, archivedName);
          continue;
        }

        const archived = this.existingFileArchiveById.get(fileId);
        if (archived) {
          await this.deleteAfdFile(archived.dirPath, archived.archiveName);
          continue;
        }

        await this.deleteAfdFile(dirPath, fileId);
      }
    }

    await this.options.vectorStore.deleteByDirId(subdirectory.dirId);
    await this.options.invertedIndex.removeDirectory(subdirectory.dirId);
  }

  private async deleteAfdFile(dirPath: string, archiveName: string): Promise<void> {
    try {
      const storage = this.getAfdStorage(dirPath);
      await storage.delete(archiveName);
    } catch {
      // 文件可能已不存在，忽略
    }
  }

  private async processFile(input: ProcessFileInput): Promise<FileMetadata> {
    const {
      dirPath,
      filePath,
      relativeFilePath,
      displayName,
      afdName,
      dirId,
      fileId,
      fileHash,
      processed,
      total,
    } = input;
    const {
      pluginManager,
      embeddingService,
      summaryService,
      vectorStore,
      invertedIndex,
      onProgress,
    } = this.options;
    const afdStorage = this.getAfdStorage(dirPath);

    const ext = displayName.split('.').pop() || '';
    const plugin = pluginManager.getPlugin(ext);
    if (!plugin) {
      throw new Error(`No plugin for extension: ${ext}`);
    }

    onProgress?.({
      phase: 'convert',
      currentFile: relativeFilePath,
      processed,
      total,
    });
    let conversionResult: DocumentConversionResult;
    try {
      conversionResult = await plugin.toMarkdown(filePath);
    } catch (error) {
      const rawMessage = (error as Error).message?.trim() ?? '';
      const detail = rawMessage.length > 0 ? rawMessage : '未提供错误详情';
      const pluginName = plugin.name || ext;
      throw new Error(`文件转换失败: ${relativeFilePath} (插件: ${pluginName}) - ${detail}`);
    }

    onProgress?.({
      phase: 'chunk',
      currentFile: relativeFilePath,
      processed,
      total,
    });
    const chunker = new MarkdownChunker(this.options.chunkOptions);
    const chunks = chunker.chunk(conversionResult.markdown);

    const content = readFileSync(filePath);
    const sourceSha256 = createHash('sha256').update(content).digest('hex');

    const summaryOptions = this.options.summaryOptions ?? {
      mode: 'batch',
      tokenBudget: 10000,
    };

    onProgress?.({
      phase: 'summary',
      currentFile: relativeFilePath,
      processed,
      total,
    });

    const chunkIds = chunks.map((_, index) => `${fileId}:${String(index).padStart(4, '0')}`);
    let chunkSummaries: string[] = [];
    if (summaryOptions.mode === 'skip') {
      chunkSummaries = chunks.map(() => '');
    } else {
      const batchResults = await summaryService.generateChunkSummariesBatch(
        chunks.map((chunk, index) => ({
          id: chunkIds[index],
          content: chunk.content,
        })),
        {
          maxRetries: summaryOptions.maxRetries,
          timeoutMs: summaryOptions.timeoutMs,
          tokenBudget: summaryOptions.tokenBudget,
          parallelRequests: summaryOptions.parallelRequests,
        }
      );
      chunkSummaries = batchResults.map((result) => result.summary);
    }

    const vectorDocs: VectorDocument[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const chunkSummary = chunkSummaries[i] ?? '';

      onProgress?.({
        phase: 'embed',
        currentFile: relativeFilePath,
        processed,
        total,
      });

      const [contentEmbed, summaryEmbed] = await Promise.all([
        embeddingService.embed(chunk.content),
        embeddingService.embed(chunkSummary),
      ]);
      const hybridEmbed = contentEmbed.map((value, index) => (value + (summaryEmbed[index] ?? 0)) / 2);

      const now = new Date().toISOString();
      vectorDocs.push({
        chunk_id: chunkIds[i],
        file_id: fileId,
        dir_id: dirId,
        rel_path: relativeFilePath,
        file_path: filePath,
        chunk_line_start: chunk.lineStart,
        chunk_line_end: chunk.lineEnd,
        content_vector: contentEmbed,
        summary_vector: summaryEmbed,
        hybrid_vector: hybridEmbed,
        locator: chunk.locator,
        indexed_at: now,
        deleted_at: '',
      });
    }

    await vectorStore.addDocuments(vectorDocs);
    const indexEntries = this.buildIndexEntries(conversionResult, chunks, chunkIds);
    await invertedIndex.addFile(fileId, dirId, indexEntries);

    onProgress?.({
      phase: 'summary',
      currentFile: relativeFilePath,
      processed,
      total,
    });

    let documentSummary = '';
    if (summaryOptions.mode !== 'skip') {
      const docSummaryResult = await summaryService.generateDocumentSummary(
        relativeFilePath,
        chunkSummaries,
        {
          maxRetries: summaryOptions.maxRetries,
          timeoutMs: summaryOptions.timeoutMs,
        }
      );
      documentSummary = docSummaryResult.summary;
    }

    onProgress?.({
      phase: 'write',
      currentFile: relativeFilePath,
      processed,
      total,
    });
    const summaries = Object.fromEntries(
      chunkIds.map((chunkId, index) => [chunkId, chunkSummaries[index] ?? ''])
    );
    await afdStorage.write(afdName, {
      'content.md': conversionResult.markdown,
      'metadata.json': JSON.stringify(
        {
          sourceFile: relativeFilePath,
          sourceHash: `sha256:${sourceSha256}`,
          plugin: ext,
          createdAt: new Date().toISOString(),
          mapping: conversionResult.mapping,
        },
        null,
        2
      ),
      'summaries.json': JSON.stringify(summaries, null, 2),
    });

    return {
      name: displayName,
      afdName,
      type: ext,
      size: content.length,
      hash: fileHash,
      fileId,
      indexedAt: new Date().toISOString(),
      chunkCount: chunkIds.length,
      summary: documentSummary,
    };
  }

  private getAfdStorage(dirPath: string): AFDStorage {
    if (this.options.afdStorageResolver) {
      return this.options.afdStorageResolver(dirPath);
    }

    return this.options.afdStorage;
  }

  private getFileParallelism(): number {
    const parallelism = this.options.fileParallelism ?? 1;
    if (!Number.isFinite(parallelism)) {
      return 1;
    }
    return Math.max(1, Math.floor(parallelism));
  }

  private reserveProcessedFile(): number {
    const current = this.processedFiles;
    this.processedFiles += 1;
    return current;
  }

  private buildExistingFileArchiveMap(
    metadataByRelativePath: Map<string, IndexMetadata>
  ): Map<string, { dirPath: string; archiveName: string }> {
    const map = new Map<string, { dirPath: string; archiveName: string }>();

    for (const metadata of metadataByRelativePath.values()) {
      for (const file of metadata.files) {
        map.set(file.fileId, {
          dirPath: metadata.directoryPath,
          archiveName: file.afdName ?? file.name ?? file.fileId,
        });
      }
    }

    return map;
  }

  private buildIndexEntries(
    conversionResult: DocumentConversionResult,
    chunks: ChunkMetadata[],
    chunkIds: string[]
  ): IndexEntry[] {
    const searchableText = conversionResult.searchableText;
    if (searchableText?.length) {
      const lineToChunk = new Map<number, string>();
      for (const [index, chunk] of chunks.entries()) {
        for (let line = chunk.lineStart; line <= chunk.lineEnd; line += 1) {
          lineToChunk.set(line, chunkIds[index]);
        }
      }

      const entries: IndexEntry[] = [];
      for (const entry of searchableText) {
        const chunkId = lineToChunk.get(entry.markdownLine);
        if (!chunkId) continue;
        entries.push({
          text: entry.text,
          chunkId,
          locator: entry.locator,
        });
      }

      if (entries.length > 0) {
        return entries;
      }
    }

    return chunks.map((chunk, index) => ({
      text: chunk.content,
      chunkId: chunkIds[index],
      locator: chunk.locator,
    }));
  }
}
