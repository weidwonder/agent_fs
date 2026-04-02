import type { EmbeddingConfig } from '@agent-fs/core';
import { EmbeddingCache } from './cache';
import { LocalEmbeddingProvider } from './local-provider';
import { APIEmbeddingProvider } from './api-provider';

/**
 * Embedding 选项
 */
export interface EmbeddingOptions {
  /** 是否使用缓存 */
  useCache?: boolean;

  /** 批处理大小 */
  batchSize?: number;
}

/**
 * Embedding 结果
 */
export interface EmbeddingResult {
  /** 向量列表 */
  embeddings: number[][];

  /** 缓存命中数 */
  cacheHits: number;

  /** API/模型调用数 */
  computations: number;
}

/**
 * Embedding 提供者接口
 */
interface EmbeddingProvider {
  init(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimension(): Promise<number>;
  dispose(): Promise<void>;
}

/**
 * Embedding 服务
 * 统一封装本地模型和 API 调用
 */
export class EmbeddingService {
  private provider: EmbeddingProvider;
  private cache: EmbeddingCache;
  private modelName: string;
  private dimension: number | null = null;
  private defaultBatchSize: number;

  constructor(config: EmbeddingConfig) {
    if (config.default === 'local' && config.local) {
      this.modelName = config.local.model;
      this.defaultBatchSize = 32;
      this.provider = new LocalEmbeddingProvider({
        model: config.local.model,
        device: config.local.device,
      });
    } else if (config.api) {
      this.modelName = config.api.model;
      this.defaultBatchSize = config.api.batch_size ?? 24;
      this.provider = new APIEmbeddingProvider({
        base_url: config.api.base_url,
        api_key: config.api.api_key,
        model: config.api.model,
        timeout: config.api.timeout_ms,
        maxRetries: config.api.max_retries,
      });
    } else {
      throw new Error('No valid embedding configuration provided');
    }

    this.cache = new EmbeddingCache(this.modelName);
  }

  /**
   * 初始化服务
   */
  async init(): Promise<void> {
    await this.provider.init();
    this.dimension = await this.provider.getDimension();
  }

  /**
   * 获取向量维度
   */
  getDimension(): number {
    if (this.dimension === null) {
      throw new Error('Service not initialized. Call init() first.');
    }
    return this.dimension;
  }

  /**
   * 生成单个文本的 embedding
   */
  async embed(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
    const { useCache = true } = options;

    if (useCache) {
      const cached = this.cache.get(text);
      if (cached) {
        return cached;
      }
    }

    const embedding = await this.provider.embed(text);

    if (useCache) {
      this.cache.set(text, embedding);
    }

    return embedding;
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[], options: EmbeddingOptions = {}): Promise<EmbeddingResult> {
    const { useCache = true, batchSize = this.defaultBatchSize } = options;

    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    let cacheHits = 0;
    let computations = 0;

    const toCompute: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      if (useCache) {
        const cached = this.cache.get(texts[i]);
        if (cached) {
          results[i] = cached;
          cacheHits++;
          continue;
        }
      }
      toCompute.push({ index: i, text: texts[i] });
    }

    for (let i = 0; i < toCompute.length; i += batchSize) {
      const batch = toCompute.slice(i, i + batchSize);
      const batchTexts = batch.map((item) => item.text);

      const embeddings = await this.provider.embedBatch(batchTexts);
      computations += embeddings.length;

      for (let j = 0; j < batch.length; j++) {
        const { index, text } = batch[j];
        results[index] = embeddings[j];

        if (useCache) {
          this.cache.set(text, embeddings[j]);
        }
      }
    }

    return {
      embeddings: results as number[][],
      cacheHits,
      computations,
    };
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.cache.stats;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    await this.provider.dispose();
    this.cache.clear();
  }
}

/**
 * 创建 Embedding 服务
 */
export function createEmbeddingService(config: EmbeddingConfig): EmbeddingService {
  return new EmbeddingService(config);
}
