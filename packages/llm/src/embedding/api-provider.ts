/**
 * API Embedding 提供者选项
 */
export interface APIEmbeddingOptions {
  /** API 地址 */
  base_url: string;

  /** API 密钥 */
  api_key: string;

  /** 模型名称 */
  model: string;

  /** 请求超时（毫秒） */
  timeout?: number;

  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * OpenAI 兼容的 API Embedding 提供者
 */
export class APIEmbeddingProvider {
  private options: Required<APIEmbeddingOptions>;

  constructor(options: APIEmbeddingOptions) {
    this.options = {
      timeout: 30000,
      maxRetries: 3,
      ...options,
    };
  }

  /**
   * 生成单个文本的 embedding
   */
  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.options.base_url}/embeddings`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.api_key}`,
          },
          body: JSON.stringify({
            model: this.options.model,
            input: texts,
          }),
          signal: AbortSignal.timeout(this.options.timeout),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`API error: ${response.status} ${error}`);
        }

        const data = await response.json();

        interface EmbeddingResponse {
          data: Array<{
            embedding: number[];
            index: number;
          }>;
        }

        const result = data as EmbeddingResponse;

        return result.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.options.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Failed to generate embeddings');
  }

  /**
   * 获取向量维度（需要先调用一次 API）
   */
  async getDimension(): Promise<number> {
    const sample = await this.embed('test');
    return sample.length;
  }

  /**
   * 初始化（API 模式无需初始化）
   */
  async init(): Promise<void> {
    // 可以在这里验证 API 可用性
  }

  /**
   * 释放资源（API 模式无需清理）
   */
  async dispose(): Promise<void> {
    // 无需清理
  }
}
