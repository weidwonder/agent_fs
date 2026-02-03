import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';

/**
 * Embedding 缓存
 */
export class EmbeddingCache {
  private cache: LRUCache<string, number[]>;
  private model: string;

  constructor(model: string, maxSize: number = 10000) {
    this.model = model;
    this.cache = new LRUCache({
      max: maxSize,
      // 估算每个 embedding 占用的内存（假设 512 维 float32）
      sizeCalculation: (value) => value.length * 4,
      maxSize: 100 * 1024 * 1024,
    });
  }

  /**
   * 生成缓存键
   */
  private makeKey(text: string): string {
    const hash = createHash('sha256').update(text).digest('hex');
    return `${this.model}:${hash}`;
  }

  /**
   * 获取缓存的 embedding
   */
  get(text: string): number[] | undefined {
    return this.cache.get(this.makeKey(text));
  }

  /**
   * 存储 embedding
   */
  set(text: string, embedding: number[]): void {
    this.cache.set(this.makeKey(text), embedding);
  }

  /**
   * 批量获取
   */
  getMany(texts: string[]): (number[] | undefined)[] {
    return texts.map((text) => this.get(text));
  }

  /**
   * 批量存储
   */
  setMany(texts: string[], embeddings: number[][]): void {
    for (let i = 0; i < texts.length; i++) {
      this.set(texts[i], embeddings[i]);
    }
  }

  /**
   * 获取缓存统计
   */
  get stats() {
    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize,
    };
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }
}
