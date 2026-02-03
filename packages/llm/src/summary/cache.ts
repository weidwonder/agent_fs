import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';

export class SummaryCache {
  private cache: LRUCache<string, string>;
  private model: string;

  constructor(model: string, maxSize: number = 5000) {
    this.model = model;
    this.cache = new LRUCache({ max: maxSize });
  }

  private makeKey(content: string, type: string): string {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    return `${this.model}:${type}:${hash}`;
  }

  get(content: string, type: string): string | undefined {
    return this.cache.get(this.makeKey(content, type));
  }

  set(content: string, type: string, summary: string): void {
    this.cache.set(this.makeKey(content, type), summary);
  }

  clear(): void {
    this.cache.clear();
  }
}
