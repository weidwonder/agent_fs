import type { FeatureExtractionPipeline } from '@xenova/transformers';

type TransformersModule = typeof import('@xenova/transformers');

let transformersModule: TransformersModule | null = null;

async function loadTransformers(): Promise<TransformersModule> {
  if (!transformersModule) {
    transformersModule = await import(/* @vite-ignore */ '@xenova/transformers');
  }
  return transformersModule;
}


/**
 * 本地 Embedding 提供者选项
 */
export interface LocalEmbeddingOptions {
  /** 模型名称 */
  model: string;

  /** 设备 */
  device?: 'cpu' | 'gpu';

  /** 模型缓存目录 */
  cacheDir?: string;
}

/**
 * 本地 Embedding 提供者
 * 使用 transformers.js 运行 ONNX 模型
 */
export class LocalEmbeddingProvider {
  private options: LocalEmbeddingOptions;
  private pipeline: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: LocalEmbeddingOptions) {
    this.options = {
      device: 'cpu',
      ...options,
    };
  }

  /**
   * 初始化模型
   */
  async init(): Promise<void> {
    if (this.pipeline) return;

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.loadModel();
    await this.initPromise;
  }

  private async loadModel(): Promise<void> {
    console.log(`Loading embedding model: ${this.options.model}`);

    const { pipeline } = await loadTransformers();

    this.pipeline = await pipeline('feature-extraction', this.options.model, {
      // quantized: true, // 使用量化模型减少内存
    });

    console.log('Embedding model loaded');
  }

  /**
   * 生成单个文本的 embedding
   */
  async embed(text: string): Promise<number[]> {
    await this.init();

    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    const result = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(result.data as Float32Array);
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.init();

    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    const results: number[][] = [];

    // transformers.js 目前不支持真正的批处理
    // 逐个处理
    for (const text of texts) {
      const result = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });
      results.push(Array.from(result.data as Float32Array));
    }

    return results;
  }

  /**
   * 获取向量维度
   */
  async getDimension(): Promise<number> {
    const sample = await this.embed('test');
    return sample.length;
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    this.pipeline = null;
    this.initPromise = null;
  }
}
