/**
 * 文本切片
 */
export interface Chunk {
  /** 切片唯一标识：file_id:chunk_index */
  id: string;

  /** 切片内容 */
  content: string;

  /** 切片摘要 */
  summary: string;

  /** Token 数量 */
  tokenCount: number;

  /** 原文定位符 */
  locator: string;

  /** 所属文件 ID */
  fileId: string;

  /** 切片索引（从 0 开始） */
  index: number;
}

/**
 * 切片元数据（用于切分阶段，尚未生成 summary）
 */
export interface ChunkMetadata {
  /** 切片内容 */
  content: string;

  /** Token 数量 */
  tokenCount: number;

  /** 原文定位符 */
  locator: string;

  /** Markdown 行范围 */
  markdownRange: {
    startLine: number;
    endLine: number;
  };
}

/**
 * 切分结果
 */
export interface ChunkResult {
  /** 切片列表 */
  chunks: ChunkMetadata[];

  /** 总 token 数 */
  totalTokens: number;
}

/**
 * 切分器选项
 */
export interface ChunkerOptions {
  /** 最小 token 数 */
  minTokens: number;

  /** 最大 token 数 */
  maxTokens: number;

  /** 重叠比例（0-1，如 0.1 表示 10%） */
  overlapRatio?: number;
}
