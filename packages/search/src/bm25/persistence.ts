import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BM25Index } from './bm25-index';
import type { BM25Document } from '@agent-fs/core';
import type { BM25Params } from './algorithm';

/**
 * 索引存储格式
 */
interface BM25Storage {
  version: string;
  createdAt: string;
  updatedAt: string;
  params: BM25Params;
  documents: BM25Document[];
}

/**
 * 保存索引到文件
 */
export function saveIndex(index: BM25Index, filePath: string): void {
  const data = index.toJSON();

  const storage: BM25Storage = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    params: data.params,
    documents: data.documents,
  };

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(storage, null, 2), 'utf-8');
}

/**
 * 从文件加载索引
 */
export function loadIndex(filePath: string): BM25Index {
  if (!existsSync(filePath)) {
    throw new Error(`Index file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const storage: BM25Storage = JSON.parse(content);

  return BM25Index.fromJSON({
    documents: storage.documents,
    params: storage.params,
  });
}

/**
 * 检查索引文件是否存在
 */
export function indexExists(filePath: string): boolean {
  return existsSync(filePath);
}
