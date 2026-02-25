import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import type { IndexProgress, Indexer } from '@agent-fs/indexer';
import { collectScopeContext, resolveProjectPath } from './search-scope';
import { getProjectMemoryFromRegistry, saveProjectMemoryFile } from './project-memory';
import { removeProjectWithBackgroundCleanup } from './project-removal';
import { resolveRendererDevUrl } from './renderer-url';
import { sanitizeForLog } from './log-sanitizer';
import { resolveDisplayLocator } from './locator-display';

let mainWindow: BrowserWindow | null = null;

// --- Window ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
  });

  const rendererDevUrl = resolveRendererDevUrl(process.env);
  if (rendererDevUrl) {
    mainWindow.loadURL(rendererDevUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- Helpers ---

function getRegistryPath(): string {
  return join(homedir(), '.agent_fs', 'registry.json');
}

function readRegistry(): { version: string; projects: any[] } {
  const path = getRegistryPath();
  if (!existsSync(path)) {
    return { version: '2.0', projects: [] };
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    if (!Array.isArray(data.projects)) {
      return { version: '2.0', projects: [] };
    }
    return data;
  } catch {
    return { version: '2.0', projects: [] };
  }
}

function writeRegistry(registry: { version: string; projects: any[] }): void {
  const dir = join(homedir(), '.agent_fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2));
}

async function cleanupRemovedProjectData(input: {
  projectPath: string;
  dirIds: string[];
}): Promise<void> {
  const fsIndexPath = join(input.projectPath, '.fs_index');
  if (existsSync(fsIndexPath)) {
    rmSync(fsIndexPath, { recursive: true, force: true });
  }

  const storagePath = join(homedir(), '.agent_fs', 'storage');
  const vectorsPath = join(storagePath, 'vectors');
  const invertedDbPath = join(storagePath, 'inverted-index', 'inverted-index.db');

  if (searchServices) {
    await deleteDirIdsFromVectorStore(searchServices.vectorStore, input.dirIds);
    await deleteDirIdsFromInvertedIndex(searchServices.invertedIndex, input.dirIds);
    return;
  }

  const { createVectorStore, InvertedIndex } = await import('@agent-fs/search');

  if (existsSync(vectorsPath)) {
    const vectorStore = createVectorStore({
      storagePath: vectorsPath,
      dimension: 1,
    });
    await vectorStore.init();
    await deleteDirIdsFromVectorStore(vectorStore as any, input.dirIds);
    await vectorStore.close();
  }

  if (existsSync(invertedDbPath)) {
    const invertedIndex = new InvertedIndex({
      dbPath: invertedDbPath,
    });
    await invertedIndex.init();
    await deleteDirIdsFromInvertedIndex(invertedIndex as any, input.dirIds);
    await invertedIndex.close();
  }
}

async function deleteDirIdsFromVectorStore(
  vectorStore: any,
  dirIds: string[]
): Promise<void> {
  if (typeof vectorStore?.deleteByDirIds === 'function') {
    await vectorStore.deleteByDirIds(dirIds);
    return;
  }

  for (const dirId of dirIds) {
    await vectorStore.deleteByDirId(dirId);
  }
}

async function deleteDirIdsFromInvertedIndex(
  invertedIndex: any,
  dirIds: string[]
): Promise<void> {
  if (typeof invertedIndex?.removeDirectories === 'function') {
    await invertedIndex.removeDirectories(dirIds);
    return;
  }

  for (const dirId of dirIds) {
    await invertedIndex.removeDirectory(dirId);
  }
}

// --- IPC: Directory Selection ---

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  return result.filePaths[0];
});

// --- IPC: Indexing ---

ipcMain.handle('start-indexing', async (_event, dirPath: string) => {
  let indexer: Indexer | null = null;

  try {
    const { createIndexer } = await import('@agent-fs/indexer');
    indexer = createIndexer({
      onProgress: (progress: IndexProgress) => {
        mainWindow?.webContents.send('indexing-progress', progress);
      },
    });

    await indexer.init();
    const metadata = await indexer.indexDirectory(dirPath);
    return { success: true, metadata };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  } finally {
    if (indexer) {
      await indexer.dispose();
    }
  }
});

// --- IPC: Registry ---

ipcMain.handle('get-registry', async () => {
  const registry = readRegistry();

  // 将所有路径 resolve 为绝对路径
  for (const p of registry.projects) {
    p.path = resolveProjectPath(p.path);
  }

  // 过滤掉作为其他项目子路径的条目（只保留顶层项目）
  const paths = registry.projects.map((p: any) => p.path.replace(/\/+$/u, ''));
  registry.projects = registry.projects.filter((p: any) => {
    const normalized = p.path.replace(/\/+$/u, '');
    return !paths.some((other: string) =>
      other !== normalized && normalized.startsWith(`${other}/`),
    );
  });

  return registry;
});

ipcMain.handle('update-project-summary', async (_event, projectId: string, newSummary: string) => {
  try {
    const registry = readRegistry();
    const project = registry.projects.find((p: any) => p.projectId === projectId);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }
    project.summary = newSummary;
    writeRegistry(registry);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('remove-project', async (_event, projectId: string) => {
  return removeProjectWithBackgroundCleanup(projectId, {
    readRegistry,
    writeRegistry,
    runCleanup: async (input) => {
      await cleanupRemovedProjectData({
        projectPath: input.projectPath,
        dirIds: input.dirIds,
      });
    },
    onStatus: (status) => {
      if (status.phase === 'failed') {
        console.error('Failed to clean project indexes:', status.projectId, status.error);
      }
      mainWindow?.webContents.send('project-removal-status', status);
    },
  });
});

// --- IPC: Memory ---

ipcMain.handle('get-project-memory', async (_event, projectId: string) => {
  try {
    const registry = readRegistry();
    return getProjectMemoryFromRegistry(registry.projects, projectId);
  } catch (error) {
    return {
      memoryPath: '',
      exists: false,
      projectMd: '',
      files: [],
      error: (error as Error).message,
    };
  }
});

ipcMain.handle('save-memory-file', async (_event, projectId: string, filePath: string, content: string) => {
  try {
    const registry = readRegistry();
    return saveProjectMemoryFile(registry.projects, projectId, filePath, content);
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// --- IPC: Config ---

ipcMain.handle('get-config', async () => {
  try {
    const { readRawConfig } = await import('@agent-fs/core');
    return readRawConfig();
  } catch (error) {
    return {
      rawConfig: {},
      resolvedConfig: {},
      envFields: [],
      error: (error as Error).message,
    };
  }
});

ipcMain.handle('save-config', async (_event, updates: Record<string, unknown>) => {
  try {
    const { saveConfig } = await import('@agent-fs/core');
    saveConfig(updates);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// --- IPC: Search ---

// 搜索服务单例（懒加载）
let searchServices: {
  embeddingService: any;
  vectorStore: any;
  invertedIndex: any;
} | null = null;

async function initSearchServices() {
  if (searchServices) return searchServices;

  const { loadConfig } = await import('@agent-fs/core');
  const { createEmbeddingService } = await import('@agent-fs/llm');
  const { createVectorStore, InvertedIndex } = await import('@agent-fs/search');

  const config = loadConfig();
  console.log('[search-init] embedding config:', JSON.stringify(sanitizeForLog(config.embedding)));
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  const vectorsPath = join(storagePath, 'vectors');
  const invertedDbPath = join(storagePath, 'inverted-index', 'inverted-index.db');
  console.log('[search-init] vectorsPath:', vectorsPath, 'exists:', existsSync(vectorsPath));
  console.log('[search-init] invertedDbPath:', invertedDbPath, 'exists:', existsSync(invertedDbPath));

  const embeddingService = createEmbeddingService(config.embedding);
  await embeddingService.init();
  console.log('[search-init] embedding dimension:', embeddingService.getDimension());

  const vectorStore = createVectorStore({
    storagePath: vectorsPath,
    dimension: embeddingService.getDimension(),
  });
  await vectorStore.init();

  const invertedIndex = new InvertedIndex({
    dbPath: invertedDbPath,
  });
  await invertedIndex.init();

  searchServices = { embeddingService, vectorStore, invertedIndex };
  console.log('[search-init] all services initialized');
  return searchServices;
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function hasLineRange(item: { chunkLineStart?: number; chunkLineEnd?: number }): boolean {
  return (
    typeof item.chunkLineStart === 'number' &&
    typeof item.chunkLineEnd === 'number' &&
    item.chunkLineStart > 0 &&
    item.chunkLineEnd >= item.chunkLineStart
  );
}

function extractByLineRange(markdown: string, lineStart?: number, lineEnd?: number): string {
  if (!markdown || !lineStart || !lineEnd || lineStart <= 0 || lineEnd < lineStart) {
    return '';
  }

  const lines = markdown.split('\n');
  return lines
    .slice(Math.max(0, lineStart - 1), Math.min(lines.length, lineEnd))
    .join('\n');
}

function extractByLocator(markdown: string, locator: string): string {
  if (!markdown || !locator) {
    return '';
  }

  const rangeMatch = /^(?:line|lines):(\d+)-(\d+)$/u.exec(locator.trim());
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    const lines = markdown.split('\n');
    return lines.slice(Math.max(0, start - 1), Math.min(lines.length, end)).join('\n');
  }

  const singleLineMatch = /^(?:line|lines):(\d+)$/u.exec(locator.trim());
  if (singleLineMatch) {
    const line = Number(singleLineMatch[1]);
    const lines = markdown.split('\n');
    return lines[line - 1] ?? '';
  }

  return '';
}

interface LocatorMappingItem {
  markdownRange: {
    startLine: number;
    endLine: number;
  };
  originalLocator: string;
}

async function readLocatorMappings(
  storage: any,
  archiveName: string,
  cacheKey: string,
  cache: Map<string, LocatorMappingItem[]>
): Promise<LocatorMappingItem[]> {
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const buffer = await storage.read(archiveName, 'metadata.json');
    const parsed = JSON.parse(buffer.toString('utf-8')) as { mapping?: LocatorMappingItem[] };
    const mapping = Array.isArray(parsed.mapping) ? parsed.mapping : [];
    cache.set(cacheKey, mapping);
    return mapping;
  } catch {
    const empty: LocatorMappingItem[] = [];
    cache.set(cacheKey, empty);
    return empty;
  }
}

ipcMain.handle('search', async (_event, input: {
  query: string;
  keyword?: string;
  scope: string[];
  top_k?: number;
}) => {
  try {
    const services = await initSearchServices();
    const { fusionRRF, aggregateTopByFile } = await import('@agent-fs/search');
    const { createAFDStorage } = await import('@agent-fs/storage');

    const startTime = Date.now();
    const topK = input.top_k ?? 10;
    const scopes = input.scope;

    // 解析 scope (projectId 数组) → dirIds + fileLookup
    const registry = readRegistry();
    const { dirIds, fileLookup } = collectScopeContext(registry.projects || [], scopes);

    // 三路搜索
    console.log('[search] scopes:', scopes);
    console.log('[search] dirIds:', dirIds);
    console.log('[search] fileLookup size:', fileLookup.size);

    const hybridResults: any[] = [];

    // 语义搜索（需要 query）
    if (input.query.trim()) {
      const queryVector = await services.embeddingService.embed(input.query);
      console.log('[search] queryVector length:', queryVector.length);

      const searchOptions = dirIds.length > 0
        ? { dirIds, topK: topK * 3, minResultsBeforeFallback: topK }
        : { topK: topK * 3, minResultsBeforeFallback: topK };
      const results = await services.vectorStore.searchByHybrid(queryVector, searchOptions);
      hybridResults.push(...results);
    }

    console.log('[search] hybridResults:', hybridResults.length);

    // 关键词搜索（query 或 keyword 任一存在即可）
    const keywordText = input.keyword?.trim() || input.query?.trim() || '';
    const keywordResults = keywordText
      ? await services.invertedIndex.search(
          keywordText,
          { dirIds: dirIds.length > 0 ? dirIds : undefined, topK: topK * 3 },
        )
      : [];

    console.log('[search] keywordResults:', keywordResults.length);

    // 构建融合输入
    interface FusionItem {
      chunkId: string;
      fileId: string;
      chunkLineStart?: number;
      chunkLineEnd?: number;
      source: { filePath: string; locator: string };
    }

    const mapVectorItem = (item: any): FusionItem => {
      const fileId = String(item.document?.file_id ?? '');
      return {
        chunkId: item.chunk_id,
        fileId,
        chunkLineStart: toPositiveInt(item.document?.chunk_line_start),
        chunkLineEnd: toPositiveInt(item.document?.chunk_line_end),
        source: {
          filePath: String(item.document?.file_path ?? '') || fileLookup.get(fileId)?.filePath || '',
          locator: String(item.document?.locator ?? ''),
        },
      };
    };

    const mapKeywordItem = (item: any): FusionItem => ({
      chunkId: item.chunkId,
      fileId: item.fileId,
      source: {
        filePath: fileLookup.get(item.fileId)?.filePath || '',
        locator: item.locator || '',
      },
    });

    const lists = [
      { name: 'hybrid_vector', items: hybridResults.map(mapVectorItem) },
      { name: 'inverted_index', items: keywordResults.map(mapKeywordItem) },
    ].filter((list: any) => list.items.length > 0);

    const fused = lists.length > 0
      ? fusionRRF(
          lists,
          (item: FusionItem) => item.chunkId,
          (existing: FusionItem, next: FusionItem) => ({
            chunkId: existing.chunkId,
            fileId: existing.fileId || next.fileId,
            chunkLineStart: existing.chunkLineStart ?? next.chunkLineStart,
            chunkLineEnd: existing.chunkLineEnd ?? next.chunkLineEnd,
            source: {
              filePath: existing.source.filePath || next.source.filePath,
              locator: existing.source.locator || next.source.locator,
            },
          }),
        )
      : [];

    const diversified = aggregateTopByFile(
      fused,
      topK,
      (item: FusionItem) => item.fileId || item.source.filePath,
      (item: FusionItem) => item.chunkId
    );

    const topItems = diversified.map((item: any) => item.item as FusionItem);
    const getByChunkIds = (services.vectorStore as any).getByChunkIds;
    if (typeof getByChunkIds === 'function') {
      const missingChunkIds = Array.from(
        new Set(
          topItems
            .filter((item) => !hasLineRange(item))
            .map((item) => item.chunkId)
            .filter((chunkId) => chunkId.length > 0)
        )
      );

      if (missingChunkIds.length > 0) {
        try {
          const docs = await getByChunkIds.call(services.vectorStore, missingChunkIds);
          const lineRangeByChunkId = new Map<string, { start: number; end: number }>();
          for (const doc of docs || []) {
            const chunkId = String(doc.chunk_id ?? '');
            if (!chunkId) continue;
            const start = toPositiveInt(doc.chunk_line_start);
            const end = toPositiveInt(doc.chunk_line_end);
            if (start === undefined || end === undefined) continue;
            lineRangeByChunkId.set(chunkId, { start, end });
          }

          for (const item of topItems) {
            if (hasLineRange(item)) continue;
            const lineRange = lineRangeByChunkId.get(item.chunkId);
            if (!lineRange) continue;
            item.chunkLineStart = lineRange.start;
            item.chunkLineEnd = lineRange.end;
          }
        } catch {
          // 忽略行号补全失败，后续仍可返回路径与定位符
        }
      }
    }

    // 内容回填
    const afdCache = new Map<string, any>();
    const markdownCache = new Map<string, string>();
    const summariesCache = new Map<string, Record<string, string>>();
    const locatorMappingCache = new Map<string, LocatorMappingItem[]>();

    const getStorage = (dirPath: string) => {
      if (!afdCache.has(dirPath)) {
        afdCache.set(dirPath, createAFDStorage({
          documentsDir: join(dirPath, '.fs_index', 'documents'),
        }));
      }
      return afdCache.get(dirPath)!;
    };

    const hydratedResults = await Promise.all(
      diversified.map(async (fusedItem: any) => {
        const item: FusionItem = fusedItem.item;
        const fileInfo = fileLookup.get(item.fileId);

        let content = '';
        let summary = '';

        if (fileInfo) {
          const storage = getStorage(fileInfo.dirPath);
          const archiveName = fileInfo.afdName || item.fileId;
          const archiveCacheKey = `${fileInfo.dirPath}/${archiveName}`;

          // 读取 markdown
          if (!markdownCache.has(archiveCacheKey)) {
            try {
              const md = await storage.readText(archiveName, 'content.md');
              markdownCache.set(archiveCacheKey, md);
            } catch {
              markdownCache.set(archiveCacheKey, '');
            }
          }
          const markdown = markdownCache.get(archiveCacheKey) || '';

          const parsedByLineRange = extractByLineRange(markdown, item.chunkLineStart, item.chunkLineEnd);
          const parsedByLocator = parsedByLineRange ? '' : extractByLocator(markdown, item.source.locator);
          content = parsedByLineRange || parsedByLocator;

          // 读取摘要
          if (!summariesCache.has(archiveCacheKey)) {
            try {
              const buf = await storage.read(archiveName, 'summaries.json');
              summariesCache.set(archiveCacheKey, JSON.parse(buf.toString('utf-8')));
            } catch {
              summariesCache.set(archiveCacheKey, {});
            }
          }
          summary = (summariesCache.get(archiveCacheKey) || {})[item.chunkId] || '';

          const locatorMappings = await readLocatorMappings(
            storage,
            archiveName,
            archiveCacheKey,
            locatorMappingCache,
          );
          item.source.locator = resolveDisplayLocator({
            filePath: fileInfo.filePath || item.source.filePath,
            locator: item.source.locator,
            chunkLineStart: item.chunkLineStart,
            chunkLineEnd: item.chunkLineEnd,
            mappings: locatorMappings,
          });
        }

        return {
          chunk_id: item.chunkId,
          score: fusedItem.score,
          content,
          summary,
          chunk_hits: fusedItem.chunkHits,
          aggregated_chunk_ids: fusedItem.chunkIds,
          source: {
            file_path: fileInfo?.filePath || item.source.filePath,
            locator: item.source.locator,
          },
        };
      }),
    );

    return {
      results: hydratedResults,
      meta: {
        total_searched: lists.reduce((sum: number, list: any) => sum + list.items.length, 0),
        fusion_method: 'rrf',
        elapsed_ms: Date.now() - startTime,
      },
    };
  } catch (error) {
    throw new Error(`搜索失败: ${(error as Error).message}`);
  }
});

// 应用退出时清理搜索服务
app.on('before-quit', async () => {
  if (searchServices) {
    try {
      await searchServices.vectorStore?.close();
      await searchServices.invertedIndex?.close();
      await searchServices.embeddingService?.dispose();
    } catch { /* ignore */ }
    searchServices = null;
  }
});
