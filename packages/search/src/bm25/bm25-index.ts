import { tokenize, termFrequency } from './tokenizer';
import { bm25Score, DEFAULT_BM25_PARAMS, type BM25Params } from './algorithm';
import type { BM25Document, BM25SearchResult } from '@agent-fs/core';

/**
 * BM25 索引选项
 */
export interface BM25IndexOptions {
  /** BM25 参数 */
  params?: BM25Params;
}

/**
 * 内部文档结构
 */
interface InternalDocument {
  doc: BM25Document;
  tokens: string[];
  termFreq: Map<string, number>;
  length: number;
}

/**
 * BM25 搜索选项
 */
export interface BM25SearchOptions {
  /** 返回数量 */
  topK?: number;

  /** 目录 ID 过滤 */
  dirId?: string;

  /** 文件路径前缀过滤 */
  filePathPrefix?: string;

  /** 是否包含已删除文档 */
  includeDeleted?: boolean;
}

/**
 * BM25 索引类
 */
export class BM25Index {
  private documents: Map<string, InternalDocument> = new Map();
  private docFreqs: Map<string, number> = new Map();
  private totalDocLength = 0;
  private params: BM25Params;

  constructor(options: BM25IndexOptions = {}) {
    this.params = options.params ?? DEFAULT_BM25_PARAMS;
  }

  /**
   * 添加文档
   */
  addDocument(doc: BM25Document): void {
    if (this.documents.has(doc.chunk_id)) {
      this.removeDocument(doc.chunk_id);
    }

    const tokens = tokenize(doc.content);
    const termFreq = termFrequency(tokens);
    const length = tokens.length;

    for (const term of termFreq.keys()) {
      this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
    }

    this.documents.set(doc.chunk_id, {
      doc,
      tokens,
      termFreq,
      length,
    });

    this.totalDocLength += length;
  }

  /**
   * 批量添加文档
   */
  addDocuments(docs: BM25Document[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }

  /**
   * 删除文档（物理删除）
   */
  removeDocument(chunkId: string): boolean {
    const internal = this.documents.get(chunkId);
    if (!internal) return false;

    for (const term of internal.termFreq.keys()) {
      const freq = this.docFreqs.get(term) || 0;
      if (freq <= 1) {
        this.docFreqs.delete(term);
      } else {
        this.docFreqs.set(term, freq - 1);
      }
    }

    this.totalDocLength -= internal.length;
    this.documents.delete(chunkId);

    return true;
  }

  /**
   * 软删除文档（设置 deletedAt）
   */
  softDelete(chunkId: string): boolean {
    const internal = this.documents.get(chunkId);
    if (!internal) return false;

    internal.doc.deleted_at = new Date().toISOString();
    return true;
  }

  /**
   * 按目录 ID 删除所有文档
   */
  removeByDirId(dirId: string): number {
    let count = 0;
    for (const [chunkId, internal] of this.documents) {
      if (internal.doc.dir_id === dirId) {
        this.removeDocument(chunkId);
        count++;
      }
    }
    return count;
  }

  /**
   * 按文件 ID 删除所有文档
   */
  removeByFileId(fileId: string): number {
    let count = 0;
    for (const [chunkId, internal] of this.documents) {
      if (internal.doc.file_id === fileId) {
        this.removeDocument(chunkId);
        count++;
      }
    }
    return count;
  }

  /**
   * 搜索
   */
  search(query: string, options: BM25SearchOptions = {}): BM25SearchResult[] {
    const { topK = 10, dirId, filePathPrefix, includeDeleted = false } = options;

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const docCount = this.documents.size;
    if (docCount === 0) return [];

    const avgDocLength = this.totalDocLength / docCount;
    const results: BM25SearchResult[] = [];

    for (const internal of this.documents.values()) {
      if (!includeDeleted && internal.doc.deleted_at) continue;

      if (dirId && internal.doc.dir_id !== dirId) continue;

      if (filePathPrefix && !internal.doc.file_path.startsWith(filePathPrefix)) continue;

      const score = bm25Score(
        queryTokens,
        internal.termFreq,
        internal.length,
        avgDocLength,
        this.docFreqs,
        docCount,
        this.params
      );

      if (score > 0) {
        results.push({
          chunk_id: internal.doc.chunk_id,
          score,
          document: internal.doc,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * 获取文档数量
   */
  get size(): number {
    return this.documents.size;
  }

  /**
   * 获取活跃文档数量（不含已删除）
   */
  get activeSize(): number {
    let count = 0;
    for (const internal of this.documents.values()) {
      if (!internal.doc.deleted_at) {
        count++;
      }
    }
    return count;
  }

  /**
   * 获取 tombstone 比例
   */
  get tombstoneRatio(): number {
    if (this.documents.size === 0) return 0;
    return (this.documents.size - this.activeSize) / this.documents.size;
  }

  /**
   * 导出为可序列化对象
   */
  toJSON(): {
    documents: BM25Document[];
    params: BM25Params;
  } {
    const documents: BM25Document[] = [];
    for (const internal of this.documents.values()) {
      documents.push(internal.doc);
    }
    return { documents, params: this.params };
  }

  /**
   * 从序列化对象恢复
   */
  static fromJSON(data: { documents: BM25Document[]; params?: BM25Params }): BM25Index {
    const index = new BM25Index({ params: data.params });
    index.addDocuments(data.documents);
    return index;
  }

  /**
   * 压缩索引（移除 tombstone）
   */
  compact(): number {
    let removed = 0;
    for (const [chunkId, internal] of this.documents) {
      if (internal.doc.deleted_at) {
        this.removeDocument(chunkId);
        removed++;
      }
    }
    return removed;
  }
}
