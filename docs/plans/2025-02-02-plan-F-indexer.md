# [F] Indexer - 索引流程实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 整合所有组件，实现完整的文档索引流程

**Architecture:** 流水线处理：scan → convert → chunk → summary → embed → store

**Tech Stack:** TypeScript, Node.js fs

**依赖:** [B1-B4], [C1-C2], [D], [E], [P1]

**被依赖:** [G1] mcp-server, [G2] electron-app

---

## 成功标准

- [ ] 能扫描目录发现支持的文件
- [ ] 能调用插件转换文档
- [ ] 完整流水线运行成功
- [ ] 索引结果写入 .fs_index 和集中存储
- [ ] registry.json 正确更新
- [ ] 支持进度回调
- [ ] 集成测试通过

---

## 重要说明

### 字段命名约定

- **内部存储**（`VectorDocument`, `BM25Document`）使用 **snake_case**
- **外部 JSON 文件**（`index.json`, `registry.json`）使用 **camelCase**

构建存储文档时使用 snake_case，`deleted_at` 使用空字符串表示未删除。

---

## Task 1: 创建 indexer 包结构

**Files:**
- Create: `packages/indexer/package.json`
- Create: `packages/indexer/tsconfig.json`
- Create: `packages/indexer/src/index.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/indexer/src`

**Step 2: 创建 package.json**

```json
{
  "name": "@agent-fs/indexer",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@agent-fs/core": "workspace:*",
    "@agent-fs/search": "workspace:*",
    "@agent-fs/llm": "workspace:*",
    "@agent-fs/plugin-markdown": "workspace:*",
    "@agent-fs/plugin-pdf": "workspace:*",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/uuid": "^9.0.0",
    "typescript": "^5.3.0"
  }
}
```

---

## Task 2: 实现插件管理器

**Files:**
- Create: `packages/indexer/src/plugin-manager.ts`

```typescript
import type { DocumentPlugin } from '@agent-fs/core';

export class PluginManager {
  private plugins: Map<string, DocumentPlugin> = new Map();

  register(plugin: DocumentPlugin): void {
    for (const ext of plugin.supportedExtensions) {
      this.plugins.set(ext.toLowerCase(), plugin);
    }
  }

  getPlugin(extension: string): DocumentPlugin | undefined {
    return this.plugins.get(extension.toLowerCase());
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.plugins.keys());
  }

  async initAll(): Promise<void> {
    for (const plugin of new Set(this.plugins.values())) {
      await plugin.init?.();
    }
  }

  async disposeAll(): Promise<void> {
    for (const plugin of new Set(this.plugins.values())) {
      await plugin.dispose?.();
    }
  }
}
```

---

## Task 3: 实现目录扫描器

**Files:**
- Create: `packages/indexer/src/scanner.ts`

```typescript
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface ScanResult {
  supportedFiles: string[];
  unsupportedFiles: string[];
  subdirectories: string[];
}

export function scanDirectory(
  dirPath: string,
  supportedExtensions: string[]
): ScanResult {
  const supported: string[] = [];
  const unsupported: string[] = [];
  const subdirs: string[] = [];

  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    if (entry.startsWith('.')) continue; // 跳过隐藏文件

    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      subdirs.push(entry);
    } else if (stat.isFile()) {
      const ext = extname(entry).slice(1).toLowerCase();
      if (supportedExtensions.includes(ext)) {
        supported.push(entry);
      } else {
        unsupported.push(entry);
      }
    }
  }

  return {
    supportedFiles: supported,
    unsupportedFiles: unsupported,
    subdirectories: subdirs,
  };
}
```

---

## Task 4: 实现索引流水线

**Files:**
- Create: `packages/indexer/src/pipeline.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IndexMetadata,
  FileMetadata,
  VectorDocument,
  BM25Document,
} from '@agent-fs/core';
import { MarkdownChunker } from '@agent-fs/core';
import type { EmbeddingService, SummaryService } from '@agent-fs/llm';
import type { VectorStore, BM25Index } from '@agent-fs/search';
import type { PluginManager } from './plugin-manager';

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
  bm25Index: BM25Index;
  chunkOptions: { minTokens: number; maxTokens: number };
  onProgress?: (progress: IndexProgress) => void;
}

export class IndexPipeline {
  private options: IndexerOptions;
  private dirId: string;

  constructor(options: IndexerOptions) {
    this.options = options;
    this.dirId = uuidv4();
  }

  async run(): Promise<IndexMetadata> {
    const { dirPath, pluginManager, onProgress } = this.options;

    // 确保 .fs_index 目录存在
    const fsIndexPath = join(dirPath, '.fs_index');
    mkdirSync(fsIndexPath, { recursive: true });
    mkdirSync(join(fsIndexPath, 'documents'), { recursive: true });

    // 扫描目录
    const extensions = pluginManager.getSupportedExtensions();
    const { scanDirectory } = await import('./scanner');
    const scanResult = scanDirectory(dirPath, extensions);

    const files: FileMetadata[] = [];
    let totalChunks = 0;
    let totalTokens = 0;

    // 处理每个文件
    for (let i = 0; i < scanResult.supportedFiles.length; i++) {
      const filename = scanResult.supportedFiles[i];
      const filePath = join(dirPath, filename);

      onProgress?.({
        phase: 'convert',
        currentFile: filename,
        processed: i,
        total: scanResult.supportedFiles.length,
      });

      const fileMetadata = await this.processFile(filePath, filename, fsIndexPath);
      files.push(fileMetadata);
      totalChunks += fileMetadata.chunkCount;
      totalTokens += fileMetadata.chunkIds.length * 800; // 估算
    }

    // 生成目录 summary
    const fileSummaries = files.map((f) => `${f.name}: ${f.summary}`);
    const dirSummaryResult = await this.options.summaryService.generateDirectorySummary(
      dirPath,
      fileSummaries,
      []
    );

    // 写入 index.json（使用 camelCase，这是外部 JSON 格式）
    const metadata: IndexMetadata = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dirId: this.dirId,
      directoryPath: dirPath,
      directorySummary: dirSummaryResult.summary,
      stats: {
        fileCount: files.length,
        chunkCount: totalChunks,
        totalTokens,
      },
      files,
      subdirectories: scanResult.subdirectories.map((name) => ({
        name,
        hasIndex: existsSync(join(dirPath, name, '.fs_index', 'index.json')),
        summary: null,
        lastUpdated: null,
      })),
      unsupportedFiles: scanResult.unsupportedFiles,
    };

    writeFileSync(
      join(fsIndexPath, 'index.json'),
      JSON.stringify(metadata, null, 2)
    );

    return metadata;
  }

  private async processFile(
    filePath: string,
    filename: string,
    fsIndexPath: string
  ): Promise<FileMetadata> {
    const { pluginManager, embeddingService, summaryService, vectorStore, bm25Index } =
      this.options;

    // 获取插件
    const ext = filename.split('.').pop() || '';
    const plugin = pluginManager.getPlugin(ext);
    if (!plugin) throw new Error(`No plugin for extension: ${ext}`);

    // 转换为 Markdown
    const conversionResult = await plugin.toMarkdown(filePath);

    // 切分
    const chunker = new MarkdownChunker(this.options.chunkOptions);
    const chunks = chunker.chunk(conversionResult.markdown);

    // 计算文件 hash
    const content = readFileSync(filePath);
    const fileHash = createHash('sha256').update(content).digest('hex');
    const fileId = createHash('sha256')
      .update(`${this.dirId}:${filename}:${fileHash}`)
      .digest('hex')
      .slice(0, 16);

    // 生成 chunk summary 和 embedding
    const chunkIds: string[] = [];
    const vectorDocs: VectorDocument[] = [];
    const bm25Docs: BM25Document[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = `${fileId}:${String(i).padStart(4, '0')}`;
      chunkIds.push(chunkId);

      // 生成 summary
      const summaryResult = await summaryService.generateChunkSummary(chunk.content);

      // 生成 embedding
      const [contentEmbed, summaryEmbed] = await Promise.all([
        embeddingService.embed(chunk.content),
        embeddingService.embed(summaryResult.summary),
      ]);

      const now = new Date().toISOString();

      // 使用 snake_case（内部存储格式）
      vectorDocs.push({
        chunk_id: chunkId,
        file_id: fileId,
        dir_id: this.dirId,
        rel_path: filename,
        file_path: filePath,
        content: chunk.content,
        summary: summaryResult.summary,
        content_vector: contentEmbed,
        summary_vector: summaryEmbed,
        locator: chunk.locator,
        indexed_at: now,
        deleted_at: '',  // 空字符串表示未删除
      });

      bm25Docs.push({
        chunk_id: chunkId,
        file_id: fileId,
        dir_id: this.dirId,
        file_path: filePath,
        content: chunk.content,
        tokens: [],
        indexed_at: now,
        deleted_at: '',
      });
    }

    // 写入存储
    await vectorStore.addDocuments(vectorDocs);
    bm25Index.addDocuments(bm25Docs);

    // 生成文档 summary
    const chunkSummaries = vectorDocs.map((d) => d.summary);
    const docSummaryResult = await summaryService.generateDocumentSummary(
      filename,
      chunkSummaries
    );

    // 保存文档处理结果
    const docDir = join(fsIndexPath, 'documents', filename);
    mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, 'content.md'), conversionResult.markdown);
    writeFileSync(join(docDir, 'mapping.json'), JSON.stringify(conversionResult.mapping, null, 2));
    writeFileSync(
      join(docDir, 'chunks.json'),
      JSON.stringify({ document: filename, chunks }, null, 2)
    );
    writeFileSync(
      join(docDir, 'summary.json'),
      JSON.stringify({ document: docSummaryResult.summary, chunks: chunkSummaries }, null, 2)
    );

    return {
      name: filename,
      type: ext,
      size: content.length,
      hash: `sha256:${fileHash}`,
      fileId,
      indexedAt: new Date().toISOString(),
      chunkCount: chunkIds.length,
      chunkIds,
      summary: docSummaryResult.summary,
    };
  }
}
```

---

## Task 5: 实现 Indexer 主类

**Files:**
- Create: `packages/indexer/src/indexer.ts`

```typescript
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
```

---

## Task 6: 更新导出

```typescript
// packages/indexer/src/index.ts
export { Indexer, createIndexer } from './indexer';
export type { IndexerOptions } from './indexer';
export { IndexPipeline } from './pipeline';
export type { IndexProgress } from './pipeline';
export { PluginManager } from './plugin-manager';
export { scanDirectory } from './scanner';
export type { ScanResult } from './scanner';
```

---

## 完成检查清单

- [ ] 目录扫描
- [ ] 插件调度
- [ ] 完整流水线
- [ ] 索引存储（snake_case）
- [ ] Registry 更新
- [ ] 进度回调

---

## 输出接口

```typescript
import { createIndexer } from '@agent-fs/indexer';

const indexer = createIndexer({
  onProgress: (p) => console.log(`${p.phase}: ${p.currentFile} (${p.processed}/${p.total})`),
});

await indexer.init();
const metadata = await indexer.indexDirectory('/path/to/documents');
console.log('Indexed:', metadata.stats.fileCount, 'files');

await indexer.dispose();
```
