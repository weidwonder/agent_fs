import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import type { IndexEntry } from '@agent-fs/search';
import type { DocumentArchiveAdapter, StorageAdapter } from '@agent-fs/storage-adapter';
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
  storage: StorageAdapter;
  archiveResolver?: (dirPath: string) => DocumentArchiveAdapter;
  fileParallelism?: number;
  chunkOptions: { minTokens: number; maxTokens: number };
  summaryOptions: SummaryPipelineOptions;
  indexerVersion?: string;
  onProgress?: (progress: IndexProgress) => void;
}

export interface SummaryPipelineOptions {
  mode: SummaryMode;
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

interface ResumeDirectorySnapshot {
  relativePath: string;
  parentRelativePath: string | null;
  directoryPath: string;
  dirId: string;
  parentDirId: string | null;
  files: FileMetadata[];
}

interface ResumeSnapshot {
  version: '1.0';
  projectId: string;
  directories: ResumeDirectorySnapshot[];
}

type FileStage =
  | 'convert'
  | 'chunk'
  | 'summary'
  | 'embed'
  | 'index-write'
  | 'document-summary'
  | 'afd-write';

export class IndexPipeline {
  private readonly options: IndexerOptions;
  private projectId: string;
  private existingMetadataByRelativePath = new Map<string, IndexMetadata>();
  private existingFileArchiveById = new Map<string, { dirPath: string; archiveName: string }>();
  private resumeSnapshot: ResumeSnapshot | null = null;
  private resumeSnapshotPath = '';
  private processedFiles = 0;
  private totalFiles = 0;
  private readonly fileChecker = new FileChecker();
  private logFilePath = '';
  private runStartedAt = 0;

  constructor(options: IndexerOptions) {
    this.options = options;
    this.projectId = uuidv4();
  }

  async run(): Promise<IndexMetadata> {
    const { dirPath } = this.options;
    this.runStartedAt = Date.now();

    // 确保根目录索引目录存在
    mkdirSync(join(dirPath, '.fs_index'), { recursive: true });
    this.initLogFile(dirPath);
    this.writeLog({
      level: 'info',
      event: 'run_start',
      directory: dirPath,
    });

    const persistedMetadata = this.loadExistingMetadataMap(dirPath);
    const persistedRootMetadata = persistedMetadata.get('.');
    const persistedResumeSnapshot = this.loadResumeSnapshot(dirPath);
    const persistedResumeProjectId = persistedResumeSnapshot?.projectId;
    const canRecoverFromResume =
      Boolean(persistedResumeProjectId) &&
      (!persistedRootMetadata ||
        persistedRootMetadata.projectId === persistedResumeProjectId);
    const recoveredMetadata =
      canRecoverFromResume && persistedResumeSnapshot
        ? this.buildMetadataMapFromResumeSnapshot(persistedResumeSnapshot)
        : null;

    this.existingMetadataByRelativePath = persistedMetadata;
    if (recoveredMetadata) {
      for (const [relativePath, metadata] of recoveredMetadata) {
        if (!this.existingMetadataByRelativePath.has(relativePath)) {
          this.existingMetadataByRelativePath.set(relativePath, metadata);
        }
      }
    }

    const existingRoot = this.existingMetadataByRelativePath.get('.');
    this.projectId =
      existingRoot?.projectId ??
      (canRecoverFromResume ? persistedResumeSnapshot?.projectId : undefined) ??
      uuidv4();
    this.initResumeSnapshot(dirPath, canRecoverFromResume ? persistedResumeSnapshot : null);
    this.existingFileArchiveById = this.buildExistingFileArchiveMap(
      this.existingMetadataByRelativePath
    );
    const rootDirId = existingRoot?.dirId ?? this.projectId;

    const tree = this.scanDirectoryTree(
      dirPath,
      '.',
      null,
      rootDirId,
      this.existingMetadataByRelativePath
    );
    this.totalFiles = this.countSupportedFiles(tree);
    this.writeLog({
      level: 'info',
      event: 'scan_done',
      totalFiles: this.totalFiles,
    });

    try {
      const result = await this.indexDirectoryTree(tree);
      this.clearResumeSnapshot();
      this.writeLog({
        level: 'info',
        event: 'run_success',
        durationMs: Date.now() - this.runStartedAt,
        totalFiles: this.totalFiles,
      });
      return result.metadata;
    } catch (error) {
      this.writeLog({
        level: 'error',
        event: 'run_error',
        durationMs: Date.now() - this.runStartedAt,
        detail: this.extractErrorMessage(error),
      });
      throw error;
    }
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
          const archivedName = previousFile.afdName ?? previousFile.name ?? previousFile.fileId;
          const archivedExists = await this.checkAfdExists(context.dirPath, archivedName);
          if (archivedExists) {
            ownFilesByIndex[fileIndex] = previousFile;
            this.recordResumeFile(context, previousFile);
            continue;
          }

          this.writeLog({
            level: 'warn',
            event: 'resume_archive_missing',
            file: relativeFilePath,
            archive: archivedName,
          });
        }

        if (previousFile) {
          await this.cleanupFileArtifacts(
            previousFile.fileId,
            context.dirPath,
            previousFile.afdName ?? previousFile.name ?? previousFile.fileId
          );
          this.removeResumeFile(context.relativePath, filename);
        }

        const fileId = previousFile?.fileId ?? this.createFileId(relativeFilePath);
        const processedFile = await this.processFile({
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
        ownFilesByIndex[fileIndex] = processedFile;
        this.recordResumeFile(context, processedFile);
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
      this.removeResumeFile(context.relativePath, removedFile.name);
    }
    this.replaceResumeDirectoryFiles(context, ownFiles);

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
      const removedRelativePath =
        context.relativePath === '.'
          ? oldSubdirectory.name
          : `${context.relativePath}/${oldSubdirectory.name}`;
      this.removeResumeDirectory(removedRelativePath);
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
      indexedWithVersion: this.options.indexerVersion || 'unknown',
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
    await this.options.storage.vector.deleteByFileId(fileId);
    await this.options.storage.invertedIndex.removeFile(fileId);
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

    await this.options.storage.vector.deleteByDirId(subdirectory.dirId);
    await this.options.storage.invertedIndex.removeDirectory(subdirectory.dirId);
  }

  private async deleteAfdFile(dirPath: string, archiveName: string): Promise<void> {
    try {
      const archive = this.getArchive(dirPath);
      await archive.delete(archiveName);
    } catch {
      // 文件可能已不存在，忽略
    }
  }

  private async checkAfdExists(dirPath: string, archiveName: string): Promise<boolean> {
    const archive = this.getArchive(dirPath);
    try {
      return await archive.exists(archiveName);
    } catch {
      return false;
    }
  }

  private loadResumeSnapshot(rootDirPath: string): ResumeSnapshot | null {
    const snapshotPath = join(rootDirPath, '.fs_index', 'index.resume.json');
    if (!existsSync(snapshotPath)) {
      return null;
    }

    try {
      const raw = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as ResumeSnapshot;
      if (!raw || typeof raw.projectId !== 'string' || !Array.isArray(raw.directories)) {
        return null;
      }

      const directories: ResumeDirectorySnapshot[] = raw.directories
        .filter((item) => item && typeof item.relativePath === 'string')
        .map((item) => {
          const relativePath = item.relativePath.trim();
          const files = Array.isArray(item.files)
            ? item.files
                .filter((file) => file && typeof file.name === 'string')
                .map((file) => ({
                  name: file.name,
                  afdName: file.afdName,
                  type: file.type,
                  size: file.size,
                  hash: file.hash,
                  fileId: file.fileId,
                  indexedAt: file.indexedAt,
                  chunkCount: file.chunkCount,
                  summary: file.summary,
                }))
            : [];

          return {
            relativePath,
            parentRelativePath: this.getParentRelativePath(relativePath),
            directoryPath: item.directoryPath,
            dirId: item.dirId,
            parentDirId: item.parentDirId,
            files,
          };
        })
        .filter((item) => item.relativePath.length > 0);

      return {
        version: '1.0',
        projectId: raw.projectId,
        directories,
      };
    } catch {
      return null;
    }
  }

  private initResumeSnapshot(rootDirPath: string, loadedSnapshot: ResumeSnapshot | null): void {
    this.resumeSnapshotPath = join(rootDirPath, '.fs_index', 'index.resume.json');
    if (loadedSnapshot && loadedSnapshot.projectId === this.projectId) {
      this.resumeSnapshot = loadedSnapshot;
    } else {
      this.resumeSnapshot = {
        version: '1.0',
        projectId: this.projectId,
        directories: [],
      };
    }
    this.persistResumeSnapshot();
  }

  private clearResumeSnapshot(): void {
    this.resumeSnapshot = null;
    if (!this.resumeSnapshotPath || !existsSync(this.resumeSnapshotPath)) {
      return;
    }

    try {
      rmSync(this.resumeSnapshotPath, { force: true });
    } catch {
      // 清理恢复快照失败不影响主流程
    }
  }

  private persistResumeSnapshot(): void {
    if (!this.resumeSnapshot || !this.resumeSnapshotPath) {
      return;
    }

    try {
      writeFileSync(this.resumeSnapshotPath, JSON.stringify(this.resumeSnapshot, null, 2));
    } catch (error) {
      this.writeLog({
        level: 'warn',
        event: 'resume_snapshot_write_failed',
        detail: this.extractErrorMessage(error),
      });
    }
  }

  private ensureResumeDirectory(context: DirectoryContext): ResumeDirectorySnapshot | null {
    if (!this.resumeSnapshot) {
      return null;
    }

    const parentRelativePath = this.getParentRelativePath(context.relativePath);
    const existing = this.resumeSnapshot.directories.find(
      (item) => item.relativePath === context.relativePath
    );
    if (existing) {
      existing.parentRelativePath = parentRelativePath;
      existing.directoryPath = context.dirPath;
      existing.dirId = context.dirId;
      existing.parentDirId = context.parentDirId;
      return existing;
    }

    const created: ResumeDirectorySnapshot = {
      relativePath: context.relativePath,
      parentRelativePath,
      directoryPath: context.dirPath,
      dirId: context.dirId,
      parentDirId: context.parentDirId,
      files: [],
    };
    this.resumeSnapshot.directories.push(created);
    return created;
  }

  private recordResumeFile(context: DirectoryContext, file: FileMetadata): void {
    const directory = this.ensureResumeDirectory(context);
    if (!directory) {
      return;
    }

    const nextFile = {
      ...file,
    };
    const existingIndex = directory.files.findIndex((item) => item.name === file.name);
    if (existingIndex >= 0) {
      directory.files[existingIndex] = nextFile;
    } else {
      directory.files.push(nextFile);
      directory.files.sort((left, right) => left.name.localeCompare(right.name));
    }

    this.persistResumeSnapshot();
  }

  private replaceResumeDirectoryFiles(context: DirectoryContext, files: FileMetadata[]): void {
    const directory = this.ensureResumeDirectory(context);
    if (!directory) {
      return;
    }

    directory.files = files
      .map((file) => ({
        ...file,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    this.persistResumeSnapshot();
  }

  private removeResumeFile(relativePath: string, filename: string): void {
    if (!this.resumeSnapshot) {
      return;
    }

    const directory = this.resumeSnapshot.directories.find((item) => item.relativePath === relativePath);
    if (!directory) {
      return;
    }

    const previousLength = directory.files.length;
    directory.files = directory.files.filter((file) => file.name !== filename);
    if (directory.files.length !== previousLength) {
      this.persistResumeSnapshot();
    }
  }

  private removeResumeDirectory(relativePath: string): void {
    if (!this.resumeSnapshot) {
      return;
    }

    const prefix = `${relativePath}/`;
    const previousLength = this.resumeSnapshot.directories.length;
    this.resumeSnapshot.directories = this.resumeSnapshot.directories.filter(
      (item) => item.relativePath !== relativePath && !item.relativePath.startsWith(prefix)
    );
    if (this.resumeSnapshot.directories.length !== previousLength) {
      this.persistResumeSnapshot();
    }
  }

  private buildMetadataMapFromResumeSnapshot(snapshot: ResumeSnapshot): Map<string, IndexMetadata> {
    const directories = snapshot.directories
      .map((item) => ({
        ...item,
        files: item.files.map((file) => ({ ...file })),
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    const directoryByRelativePath = new Map(directories.map((item) => [item.relativePath, item]));
    const childrenByParent = new Map<string | null, ResumeDirectorySnapshot[]>();
    for (const directory of directories) {
      const key = directory.parentRelativePath;
      const children = childrenByParent.get(key) ?? [];
      children.push(directory);
      childrenByParent.set(key, children);
    }

    const aggregateFilesCache = new Map<string, FileMetadata[]>();
    const collectAggregateFiles = (relativePath: string): FileMetadata[] => {
      const cached = aggregateFilesCache.get(relativePath);
      if (cached) {
        return cached;
      }

      const current = directoryByRelativePath.get(relativePath);
      if (!current) {
        return [];
      }

      const merged = [...current.files];
      for (const child of childrenByParent.get(relativePath) ?? []) {
        merged.push(...collectAggregateFiles(child.relativePath));
      }
      aggregateFilesCache.set(relativePath, merged);
      return merged;
    };

    const now = new Date().toISOString();
    const metadataMap = new Map<string, IndexMetadata>();
    for (const directory of directories) {
      const allFiles = collectAggregateFiles(directory.relativePath);
      const childDirectories = childrenByParent.get(directory.relativePath) ?? [];

      metadataMap.set(directory.relativePath, {
        version: '2.0',
        indexedWithVersion: this.options.indexerVersion || 'unknown',
        createdAt: directory.files[0]?.indexedAt ?? now,
        updatedAt: now,
        dirId: directory.dirId,
        directoryPath: directory.directoryPath,
        directorySummary: '',
        projectId: snapshot.projectId,
        relativePath: directory.relativePath,
        parentDirId: directory.parentDirId,
        stats: {
          fileCount: allFiles.length,
          chunkCount: allFiles.reduce((sum, file) => sum + file.chunkCount, 0),
          totalTokens: allFiles.reduce((sum, file) => sum + file.chunkCount * 800, 0),
        },
        files: directory.files,
        subdirectories: childDirectories.map((child) => {
          const descendantFiles = collectAggregateFiles(child.relativePath);
          return {
            name: basename(child.directoryPath),
            dirId: child.dirId,
            hasIndex: true,
            summary: null,
            fileCount: descendantFiles.length,
            lastUpdated: descendantFiles[0]?.indexedAt ?? null,
            fileIds: descendantFiles.map((file) => file.fileId),
            fileArchives: descendantFiles.map((file) => ({
              fileId: file.fileId,
              afdName: file.afdName ?? file.name ?? file.fileId,
            })),
          };
        }),
        unsupportedFiles: [],
      });
    }

    return metadataMap;
  }

  private getParentRelativePath(relativePath: string): string | null {
    if (relativePath === '.') {
      return null;
    }

    const lastSlashIndex = relativePath.lastIndexOf('/');
    if (lastSlashIndex === -1) {
      return '.';
    }

    return relativePath.slice(0, lastSlashIndex);
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }

  private initLogFile(dirPath: string): void {
    const logsDir = join(dirPath, '.fs_index', 'logs');
    mkdirSync(logsDir, { recursive: true });
    this.logFilePath = join(logsDir, 'indexing.latest.jsonl');
    writeFileSync(this.logFilePath, '');
  }

  private writeLog(entry: Record<string, unknown>): void {
    if (!this.logFilePath) {
      return;
    }

    try {
      const payload = JSON.stringify({
        timestamp: new Date().toISOString(),
        ...entry,
      });
      appendFileSync(this.logFilePath, `${payload}\n`);
    } catch {
      // 日志失败不应中断索引主流程
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

  private async runFileStage<T>(params: {
    file: string;
    stage: FileStage;
    processed: number;
    total: number;
    action: () => Promise<T>;
    details?: Record<string, unknown>;
    mapError?: (detail: string) => string;
  }): Promise<T> {
    const stageStartedAt = Date.now();
    this.writeLog({
      level: 'info',
      event: 'stage_start',
      file: params.file,
      stage: params.stage,
      processed: params.processed + 1,
      total: params.total,
      ...params.details,
    });

    try {
      const result = await params.action();
      this.writeLog({
        level: 'info',
        event: 'stage_done',
        file: params.file,
        stage: params.stage,
        processed: params.processed + 1,
        total: params.total,
        durationMs: Date.now() - stageStartedAt,
      });
      return result;
    } catch (error) {
      const detail = this.extractErrorMessage(error);
      this.writeLog({
        level: 'error',
        event: 'stage_error',
        file: params.file,
        stage: params.stage,
        processed: params.processed + 1,
        total: params.total,
        durationMs: Date.now() - stageStartedAt,
        detail,
      });

      const message = params.mapError
        ? params.mapError(detail)
        : `文件处理失败: ${params.file} [阶段: ${params.stage}] - ${detail}`;
      throw new Error(message);
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
      onProgress,
    } = this.options;
    const archive = this.getArchive(dirPath);

    this.writeLog({
      level: 'info',
      event: 'file_start',
      file: relativeFilePath,
      processed: processed + 1,
      total,
    });
    const fileStartedAt = Date.now();

    const ext = displayName.split('.').pop() || '';
    const plugin = pluginManager.getPlugin(ext);
    if (!plugin) {
      const detail = `No plugin for extension: ${ext}`;
      this.writeLog({
        level: 'error',
        event: 'stage_error',
        file: relativeFilePath,
        stage: 'convert',
        processed: processed + 1,
        total,
        detail,
      });
      throw new Error(`文件处理失败: ${relativeFilePath} [阶段: convert] - ${detail}`);
    }

    onProgress?.({
      phase: 'convert',
      currentFile: relativeFilePath,
      processed,
      total,
    });
    const conversionResult = await this.runFileStage({
      file: relativeFilePath,
      stage: 'convert',
      processed,
      total,
      details: {
        plugin: plugin.name || ext,
      },
      action: async () => plugin.toMarkdown(filePath),
      mapError: (detail) => {
        const pluginName = plugin.name || ext;
        return `文件转换失败: ${relativeFilePath} (插件: ${pluginName}) - ${detail}`;
      },
    });

    onProgress?.({
      phase: 'chunk',
      currentFile: relativeFilePath,
      processed,
      total,
    });
    const chunks = await this.runFileStage({
      file: relativeFilePath,
      stage: 'chunk',
      processed,
      total,
      action: async () => {
        const chunker = new MarkdownChunker(this.options.chunkOptions);
        return chunker.chunk(conversionResult.markdown);
      },
    });

    const content = readFileSync(filePath);
    const sourceSha256 = createHash('sha256').update(content).digest('hex');

    const summaryOptions = this.options.summaryOptions ?? {
      mode: 'batch',
    };

    const chunkIds = chunks.map((_, index) => `${fileId}:${String(index).padStart(4, '0')}`);
    onProgress?.({
      phase: 'embed',
      currentFile: relativeFilePath,
      processed,
      total,
    });

    const vectorDocs = await this.runFileStage({
      file: relativeFilePath,
      stage: 'embed',
      processed,
      total,
      details: {
        chunkCount: chunks.length,
      },
      action: async () => {
        const docs: VectorDocument[] = [];
        const maybeEmbedBatch = (
          embeddingService as unknown as {
            embedBatch?: (
              texts: string[],
              options?: { useCache?: boolean; batchSize?: number }
            ) => Promise<{ embeddings: number[][] }>;
          }
        ).embedBatch;

        if (typeof maybeEmbedBatch === 'function') {
          const contentBatch = await maybeEmbedBatch.call(
            embeddingService,
            chunks.map((chunk) => chunk.content),
            { batchSize: 8 }
          );

          for (let i = 0; i < chunks.length; i += 1) {
            const chunk = chunks[i];
            const contentEmbed = contentBatch.embeddings[i];
            const now = new Date().toISOString();
            docs.push({
              chunk_id: chunkIds[i],
              file_id: fileId,
              dir_id: dirId,
              rel_path: relativeFilePath,
              file_path: filePath,
              chunk_line_start: chunk.lineStart,
              chunk_line_end: chunk.lineEnd,
              content_vector: contentEmbed,
              locator: chunk.locator,
              indexed_at: now,
              deleted_at: '',
            });
          }

          return docs;
        }

        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i];
          onProgress?.({
            phase: 'embed',
            currentFile: relativeFilePath,
            processed,
            total,
          });

          try {
            const contentEmbed = await embeddingService.embed(chunk.content);
            const now = new Date().toISOString();
            docs.push({
              chunk_id: chunkIds[i],
              file_id: fileId,
              dir_id: dirId,
              rel_path: relativeFilePath,
              file_path: filePath,
              chunk_line_start: chunk.lineStart,
              chunk_line_end: chunk.lineEnd,
              content_vector: contentEmbed,
              locator: chunk.locator,
              indexed_at: now,
              deleted_at: '',
            });
          } catch (error) {
            const detail = this.extractErrorMessage(error);
            throw new Error(`chunk ${i + 1}/${chunks.length} - ${detail}`);
          }
        }

        return docs;
      },
    });

    await this.runFileStage({
      file: relativeFilePath,
      stage: 'index-write',
      processed,
      total,
      details: {
        chunkCount: chunks.length,
      },
      action: async () => {
        await this.options.storage.vector.addDocuments(vectorDocs);
        const indexEntries = this.buildIndexEntries(conversionResult, chunks, chunkIds);
        await this.options.storage.invertedIndex.addFile(fileId, dirId, indexEntries);
      },
    });

    onProgress?.({
      phase: 'summary',
      currentFile: relativeFilePath,
      processed,
      total,
    });

    let documentSummary = '';
    if (summaryOptions.mode !== 'skip') {
      const docSummaryResult = await this.runFileStage({
        file: relativeFilePath,
        stage: 'document-summary',
        processed,
        total,
        details: {
          chunkCount: chunks.length,
        },
        action: async () =>
          summaryService.generateDocumentSummary(relativeFilePath, conversionResult.markdown, {
            maxRetries: summaryOptions.maxRetries,
            timeoutMs: summaryOptions.timeoutMs,
          }),
      });
      documentSummary = docSummaryResult.summary;
    }

    onProgress?.({
      phase: 'write',
      currentFile: relativeFilePath,
      processed,
      total,
    });
    const summaries = {
      documentSummary,
    };
    await this.runFileStage({
      file: relativeFilePath,
      stage: 'afd-write',
      processed,
      total,
      details: {
        archive: afdName,
      },
      action: async () =>
        archive.write(afdName, {
          files: {
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
          },
        }),
    });

    this.writeLog({
      level: 'info',
      event: 'file_done',
      file: relativeFilePath,
      processed: processed + 1,
      total,
      chunkCount: chunks.length,
      durationMs: Date.now() - fileStartedAt,
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

  private getArchive(dirPath: string): DocumentArchiveAdapter {
    if (this.options.archiveResolver) {
      return this.options.archiveResolver(dirPath);
    }

    return this.options.storage.archive;
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
