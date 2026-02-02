/**
 * 搜索结果
 */
export interface SearchResult {
  /** Chunk ID */
  chunkId: string;

  /** 相关度分数 */
  score: number;

  /** Chunk 内容 */
  content: string;

  /** Chunk 摘要 */
  summary: string;

  /** 来源信息 */
  source: {
    /** 文件路径 */
    filePath: string;

    /** 原文定位符 */
    locator: string;
  };
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  /** 语义查询 */
  query: string;

  /** 精准关键词查询（可选） */
  keyword?: string;

  /** 搜索范围：目录路径或路径数组 */
  scope: string | string[];

  /** 返回数量 */
  topK?: number;

  /** 过滤条件 */
  filters?: SearchFilters;
}

/**
 * 搜索过滤条件
 */
export interface SearchFilters {
  /** 文件类型过滤 */
  fileTypes?: string[];

  /** 文件名过滤 */
  fileNames?: string[];
}

/**
 * 搜索元信息
 */
export interface SearchMeta {
  /** 搜索的总 chunk 数 */
  totalSearched: number;

  /** 融合方法 */
  fusionMethod: string;

  /** 耗时（毫秒） */
  elapsedMs: number;
}

/**
 * 完整搜索响应
 */
export interface SearchResponse {
  /** 搜索结果列表 */
  results: SearchResult[];

  /** 元信息 */
  meta: SearchMeta;
}
