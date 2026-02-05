import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IndexMetadata,
  FileMetadata,
  VectorDocument,
  BM25Document,
  SummaryMode,
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
  summaryOptions: SummaryPipelineOptions;
  onProgress?: (progress: IndexProgress) => void;
}

export interface SummaryPipelineOptions {
  mode: SummaryMode;
  tokenBudget: number;
  maxRetries?: number;
  timeoutMs?: number;
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
    const summaryOptions = this.options.summaryOptions ?? {
      mode: 'batch',
      tokenBudget: 10000,
    };

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
    const totalFiles = scanResult.supportedFiles.length;
    for (let i = 0; i < totalFiles; i++) {
      const filename = scanResult.supportedFiles[i];
      const filePath = join(dirPath, filename);

      onProgress?.({
        phase: 'convert',
        currentFile: filename,
        processed: i,
        total: totalFiles,
      });

      const fileMetadata = await this.processFile(
        filePath,
        filename,
        fsIndexPath,
        i,
        totalFiles
      );
      files.push(fileMetadata);
      totalChunks += fileMetadata.chunkCount;
      totalTokens += fileMetadata.chunkIds.length * 800; // 估算
    }

    // 生成目录 summary
    let directorySummary = '';
    if (summaryOptions.mode !== 'skip') {
      const fileSummaries = files.map((f) => `${f.name}: ${f.summary}`);
      const dirSummaryResult = await this.options.summaryService.generateDirectorySummary(
        dirPath,
        fileSummaries,
        [],
        {
          maxRetries: summaryOptions.maxRetries,
          timeoutMs: summaryOptions.timeoutMs,
        }
      );
      directorySummary = dirSummaryResult.summary;
    }

    // 写入 index.json（使用 camelCase，这是外部 JSON 格式）
    const metadata: IndexMetadata = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dirId: this.dirId,
      directoryPath: dirPath,
      directorySummary,
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
    fsIndexPath: string,
    fileIndex: number,
    totalFiles: number
  ): Promise<FileMetadata> {
    const { pluginManager, embeddingService, summaryService, vectorStore, bm25Index } =
      this.options;
    const { onProgress } = this.options;

    // 获取插件
    const ext = filename.split('.').pop() || '';
    const plugin = pluginManager.getPlugin(ext);
    if (!plugin) throw new Error(`No plugin for extension: ${ext}`);

    // 转换为 Markdown
    onProgress?.({
      phase: 'convert',
      currentFile: filename,
      processed: fileIndex,
      total: totalFiles,
    });
    const conversionResult = await plugin.toMarkdown(filePath);

    // 切分
    onProgress?.({
      phase: 'chunk',
      currentFile: filename,
      processed: fileIndex,
      total: totalFiles,
    });
    const chunker = new MarkdownChunker(this.options.chunkOptions);
    const chunks = chunker.chunk(conversionResult.markdown);

    // 计算文件 hash
    const content = readFileSync(filePath);
    const fileHash = createHash('sha256').update(content).digest('hex');
    const fileId = createHash('sha256')
      .update(`${this.dirId}:${filename}:${fileHash}`)
      .digest('hex')
      .slice(0, 16);

    const summaryOptions = this.options.summaryOptions ?? {
      mode: 'batch',
      tokenBudget: 10000,
    };

    // 生成 chunk summary
    onProgress?.({
      phase: 'summary',
      currentFile: filename,
      processed: fileIndex,
      total: totalFiles,
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
        }
      );
      chunkSummaries = batchResults.map((result) => result.summary);
    }

    // 生成 embedding
    const vectorDocs: VectorDocument[] = [];
    const bm25Docs: BM25Document[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = chunkIds[i];
      const chunkSummary = chunkSummaries[i] ?? '';

      onProgress?.({
        phase: 'embed',
        currentFile: filename,
        processed: fileIndex,
        total: totalFiles,
      });

      const [contentEmbed, summaryEmbed] = await Promise.all([
        embeddingService.embed(chunk.content),
        embeddingService.embed(chunkSummary),
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
        summary: chunkSummary,
        content_vector: contentEmbed,
        summary_vector: summaryEmbed,
        locator: chunk.locator,
        indexed_at: now,
        deleted_at: '', // 空字符串表示未删除
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
    onProgress?.({
      phase: 'summary',
      currentFile: filename,
      processed: fileIndex,
      total: totalFiles,
    });

    let documentSummary = '';
    if (summaryOptions.mode !== 'skip') {
      const docSummaryResult = await summaryService.generateDocumentSummary(
        filename,
        chunkSummaries,
        {
          maxRetries: summaryOptions.maxRetries,
          timeoutMs: summaryOptions.timeoutMs,
        }
      );
      documentSummary = docSummaryResult.summary;
    }

    // 保存文档处理结果
    onProgress?.({
      phase: 'write',
      currentFile: filename,
      processed: fileIndex,
      total: totalFiles,
    });
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
      JSON.stringify({ document: documentSummary, chunks: chunkSummaries }, null, 2)
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
      summary: documentSummary,
    };
  }
}
