/**
 * Embedding 选项（占位）
 */
export interface EmbeddingOptions {}

/**
 * Embedding 结果（占位）
 */
export interface EmbeddingResult {
  embeddings: number[][];
  cacheHits: number;
  computations: number;
}

/**
 * Embedding 服务（占位，Task 5 会替换实现）
 */
export class EmbeddingService {
  constructor(_config: unknown) {}

  async init(): Promise<void> {
    throw new Error('未实现');
  }

  getDimension(): number {
    throw new Error('未实现');
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error('未实现');
  }

  async embedBatch(_texts: string[]): Promise<EmbeddingResult> {
    throw new Error('未实现');
  }
}

/**
 * 创建 Embedding 服务（占位）
 */
export function createEmbeddingService(config: unknown): EmbeddingService {
  return new EmbeddingService(config);
}
