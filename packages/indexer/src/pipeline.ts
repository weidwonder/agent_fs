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
