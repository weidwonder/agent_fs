/**
 * 向量文档（LanceDB 存储）
 *
 * 注意：列名使用 snake_case，因为 LanceDB 的 SQL 解析器会将列名转为小写。
 * 使用 camelCase 会导致 WHERE 过滤时找不到字段。
 */
export interface VectorDocument {
  /** Chunk ID */
  chunk_id: string;

  /** 文件 ID */
  file_id: string;

  /** 目录 ID */
  dir_id: string;

  /** 相对路径 */
  rel_path: string;

  /** 绝对路径 */
  file_path: string;

  /** Chunk 内容 */
  content: string;

  /** Chunk 摘要 */
  summary: string;

  /** 内容向量 */
  content_vector: number[];

  /** 摘要向量 */
  summary_vector: number[];

  /** 原文定位符 */
  locator: string;

  /** 索引时间 (ISO 8601) */
  indexed_at: string;

  /** 删除时间（软删除），空字符串表示未删除 */
  deleted_at: string;
}

/**
 * BM25 文档
 *
 * 注意：列名使用 snake_case 以保持与 VectorDocument 一致。
 */
export interface BM25Document {
  /** Chunk ID */
  chunk_id: string;

  /** 文件 ID */
  file_id: string;

  /** 目录 ID */
  dir_id: string;

  /** 文件路径 */
  file_path: string;

  /** Chunk 内容 */
  content: string;

  /** 分词后的 tokens */
  tokens: string[];

  /** 索引时间 (ISO 8601) */
  indexed_at: string;

  /** 删除时间（软删除），空字符串表示未删除 */
  deleted_at: string;
}

/**
 * 向量搜索结果
 */
export interface VectorSearchResult {
  /** Chunk ID */
  chunk_id: string;

  /** 相似度分数 (0-1，越高越相似) */
  score: number;

  /** 文档数据 */
  document: VectorDocument;
}

/**
 * BM25 搜索结果
 */
export interface BM25SearchResult {
  /** Chunk ID */
  chunk_id: string;

  /** BM25 分数 */
  score: number;

  /** 文档数据 */
  document: BM25Document;
}
