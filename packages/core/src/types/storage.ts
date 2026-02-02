/**
 * 向量文档（LanceDB 存储）
 */
export interface VectorDocument {
  /** Chunk ID */
  chunkId: string;

  /** 文件 ID */
  fileId: string;

  /** 目录 ID */
  dirId: string;

  /** 相对路径 */
  relPath: string;

  /** 绝对路径 */
  filePath: string;

  /** Chunk 内容 */
  content: string;

  /** Chunk 摘要 */
  summary: string;

  /** 内容向量 */
  contentVector: number[];

  /** 摘要向量 */
  summaryVector: number[];

  /** 原文定位符 */
  locator: string;

  /** 索引时间 */
  indexedAt: string;

  /** 删除时间（软删除） */
  deletedAt: string | null;
}

/**
 * BM25 文档
 */
export interface BM25Document {
  /** Chunk ID */
  chunkId: string;

  /** 文件 ID */
  fileId: string;

  /** 目录 ID */
  dirId: string;

  /** 文件路径 */
  filePath: string;

  /** Chunk 内容 */
  content: string;

  /** 分词后的 tokens */
  tokens: string[];

  /** 索引时间 */
  indexedAt: string;

  /** 删除时间（软删除） */
  deletedAt: string | null;
}

/**
 * 向量搜索结果
 */
export interface VectorSearchResult {
  /** Chunk ID */
  chunkId: string;

  /** 相似度分数 */
  score: number;

  /** 文档数据 */
  document: VectorDocument;
}

/**
 * BM25 搜索结果
 */
export interface BM25SearchResult {
  /** Chunk ID */
  chunkId: string;

  /** BM25 分数 */
  score: number;

  /** 文档数据 */
  document: BM25Document;
}
