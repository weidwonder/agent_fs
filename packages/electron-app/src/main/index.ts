import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import type { IndexProgress, Indexer } from '@agent-fs/indexer';

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

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
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
    p.path = resolve(p.path);
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
  try {
    const registry = readRegistry();
    const project = registry.projects.find((p: any) => p.projectId === projectId);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    // 1. 收集所有 dirId
    const dirIds = [project.projectId];
    for (const sub of project.subdirectories || []) {
      dirIds.push(sub.dirId);
    }

    // 2. 删除 .fs_index 目录
    const fsIndexPath = join(project.path, '.fs_index');
    if (existsSync(fsIndexPath)) {
      rmSync(fsIndexPath, { recursive: true, force: true });
    }

    // 3. 删除全局存储中的向量和倒排索引数据
    const storagePath = join(homedir(), '.agent_fs', 'storage');
    try {
      const { createVectorStore, InvertedIndex } = await import('@agent-fs/search');

      const vectorsPath = join(storagePath, 'vectors');
      if (existsSync(vectorsPath)) {
        const vectorStore = createVectorStore({ storagePath: vectorsPath, dimension: 512 });
        await vectorStore.init();
        for (const dirId of dirIds) {
          await vectorStore.deleteByDirId(dirId);
        }
        await vectorStore.close();
      }

      const invertedDbPath = join(storagePath, 'inverted-index', 'inverted-index.db');
      if (existsSync(invertedDbPath)) {
        const invertedIndex = new InvertedIndex({ dbPath: invertedDbPath });
        await invertedIndex.init();
        for (const dirId of dirIds) {
          await invertedIndex.removeDirectory(dirId);
        }
        await invertedIndex.close();
      }
    } catch (storageError) {
      console.error('Failed to clean storage:', storageError);
      // 继续执行，至少从 registry 中移除
    }

    // 4. 从 registry 移除
    registry.projects = registry.projects.filter((p: any) => p.projectId !== projectId);
    writeRegistry(registry);

    return { success: true };
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
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  const embeddingService = createEmbeddingService(config.embedding);
  await embeddingService.init();

  const vectorStore = createVectorStore({
    storagePath: join(storagePath, 'vectors'),
    dimension: embeddingService.getDimension(),
  });
  await vectorStore.init();

  const invertedIndex = new InvertedIndex({
    dbPath: join(storagePath, 'inverted-index', 'inverted-index.db'),
  });
  await invertedIndex.init();

  searchServices = { embeddingService, vectorStore, invertedIndex };
  return searchServices;
}

ipcMain.handle('search', async (_event, input: {
  query: string;
  keyword?: string;
  scope: string[];
  top_k?: number;
}) => {
  try {
    const services = await initSearchServices();
    const { fusionRRF } = await import('@agent-fs/search');
    const { createAFDStorage } = await import('@agent-fs/storage');

    const startTime = Date.now();
    const topK = input.top_k ?? 10;
    const scopes = input.scope;

    // 解析 scope → dirIds + fileLookup
    const registry = readRegistry();
    const dirIds: string[] = [];
    const fileLookup = new Map<string, { dirPath: string; filePath: string }>();

    for (const project of registry.projects) {
      if (!project.valid) continue;
      const projectPath = resolve(project.path).replace(/\/+$/u, '');

      const isRelated = scopes.some((scope: string) => {
        const s = scope.replace(/\/+$/u, '');
        return s === projectPath || s.startsWith(`${projectPath}/`) || projectPath.startsWith(`${s}/`);
      });

      if (!isRelated) continue;

      dirIds.push(project.projectId);
      for (const sub of project.subdirectories || []) {
        dirIds.push(sub.dirId);
      }

      // 读取 index.json 获取 fileLookup
      const indexPath = join(projectPath, '.fs_index', 'index.json');
      if (existsSync(indexPath)) {
        try {
          const metadata = JSON.parse(readFileSync(indexPath, 'utf-8'));
          for (const file of metadata.files || []) {
            fileLookup.set(file.fileId, {
              dirPath: projectPath,
              filePath: join(projectPath, file.name),
            });
          }
        } catch { /* skip */ }
      }
    }

    // 三路搜索
    const searchRequests = dirIds.length > 0
      ? dirIds.map((dirId: string) => ({ dirId }))
      : [{}];

    const contentResults: any[] = [];
    const summaryResults: any[] = [];

    // 语义搜索（需要 query）
    if (input.query.trim()) {
      const queryVector = await services.embeddingService.embed(input.query);

      for (const req of searchRequests) {
        const cResults = await services.vectorStore.searchByContent(queryVector, {
          ...req, topK: topK * 3,
        });
        contentResults.push(...cResults);

        const sResults = await services.vectorStore.searchBySummary(queryVector, {
          ...req, topK: topK * 3,
        });
        summaryResults.push(...sResults);
      }
    }

    // 关键词搜索（query 或 keyword 任一存在即可）
    const keywordText = input.keyword?.trim() || input.query?.trim() || '';
    const keywordResults = keywordText
      ? await services.invertedIndex.search(
          keywordText,
          { dirIds: dirIds.length > 0 ? dirIds : undefined, topK: topK * 3 },
        )
      : [];

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
        chunkLineStart: item.document?.chunk_line_start,
        chunkLineEnd: item.document?.chunk_line_end,
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
      { name: 'content_vector', items: contentResults.map(mapVectorItem) },
      { name: 'summary_vector', items: summaryResults.map(mapVectorItem) },
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

    // 内容回填
    const afdCache = new Map<string, any>();
    const markdownCache = new Map<string, string>();
    const summariesCache = new Map<string, Record<string, string>>();

    const getStorage = (dirPath: string) => {
      if (!afdCache.has(dirPath)) {
        afdCache.set(dirPath, createAFDStorage({
          documentsDir: join(dirPath, '.fs_index', 'documents'),
        }));
      }
      return afdCache.get(dirPath)!;
    };

    const hydratedResults = await Promise.all(
      fused.slice(0, topK).map(async (fusedItem: any) => {
        const item: FusionItem = fusedItem.item;
        const fileInfo = fileLookup.get(item.fileId);

        let content = '';
        let summary = '';

        if (fileInfo) {
          const storage = getStorage(fileInfo.dirPath);

          // 读取 markdown
          if (!markdownCache.has(item.fileId)) {
            try {
              const md = await storage.readText(item.fileId, 'content.md');
              markdownCache.set(item.fileId, md);
            } catch {
              markdownCache.set(item.fileId, '');
            }
          }
          const markdown = markdownCache.get(item.fileId) || '';

          // 按行范围提取内容
          if (markdown && item.chunkLineStart && item.chunkLineEnd) {
            const lines = markdown.split('\n');
            content = lines.slice(
              Math.max(0, item.chunkLineStart - 1),
              Math.min(lines.length, item.chunkLineEnd),
            ).join('\n');
          }

          // 读取摘要
          if (!summariesCache.has(item.fileId)) {
            try {
              const buf = await storage.read(item.fileId, 'summaries.json');
              summariesCache.set(item.fileId, JSON.parse(buf.toString('utf-8')));
            } catch {
              summariesCache.set(item.fileId, {});
            }
          }
          summary = (summariesCache.get(item.fileId) || {})[item.chunkId] || '';
        }

        return {
          chunk_id: item.chunkId,
          score: fusedItem.score,
          content,
          summary,
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
