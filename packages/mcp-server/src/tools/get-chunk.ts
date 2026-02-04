import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Registry, IndexMetadata } from '@agent-fs/core';
import { getVectorStore } from './search.js';

interface GetChunkInput {
  chunk_id: string;
  include_neighbors?: boolean;
  neighbor_count?: number;
}

interface ChunkInfo {
  id: string;
  content: string;
  summary: string;
  token_count: number;
  source: {
    file_path: string;
    locator: string;
  };
}

function parseChunkId(chunkId: string): { fileId: string; chunkIndex: number } {
  const parts = chunkId.split(':');
  if (parts.length < 2) {
    throw new Error(`Invalid chunk_id format: ${chunkId}`);
  }
  const chunkIndex = parseInt(parts[parts.length - 1], 10);
  const fileId = parts.slice(0, -1).join(':');
  return { fileId, chunkIndex };
}

function findFileDirectory(fileId: string): { dirPath: string; fileName: string } | null {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(registryPath)) return null;

  const registry: Registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

  for (const dir of registry.indexedDirectories) {
    if (!dir.valid) continue;

    const indexPath = join(dir.path, '.fs_index', 'index.json');
    if (!existsSync(indexPath)) continue;

    const metadata: IndexMetadata = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const file = metadata.files.find((f) => f.fileId === fileId);
    if (file) {
      return { dirPath: dir.path, fileName: file.name };
    }
  }

  return null;
}

export async function getChunk(input: GetChunkInput) {
  const { chunk_id, include_neighbors = false, neighbor_count = 2 } = input;

  try {
    const vectorStore = getVectorStore();
    const docs = await vectorStore.getByChunkIds([chunk_id]);

    if (docs.length > 0) {
      const doc = docs[0];
      const result: { chunk: ChunkInfo; neighbors?: { before: ChunkInfo[]; after: ChunkInfo[] } } = {
        chunk: {
          id: doc.chunk_id,
          content: doc.content,
          summary: doc.summary,
          token_count: Math.ceil(doc.content.length / 4),
          source: {
            file_path: doc.file_path,
            locator: doc.locator,
          },
        },
      };

      if (include_neighbors) {
        const { fileId, chunkIndex } = parseChunkId(chunk_id);
        const neighborIds: string[] = [];

        for (let i = Math.max(0, chunkIndex - neighbor_count); i < chunkIndex; i++) {
          neighborIds.push(`${fileId}:${String(i).padStart(4, '0')}`);
        }

        for (let i = chunkIndex + 1; i <= chunkIndex + neighbor_count; i++) {
          neighborIds.push(`${fileId}:${String(i).padStart(4, '0')}`);
        }

        const neighborDocs = await vectorStore.getByChunkIds(neighborIds);
        const neighborMap = new Map(neighborDocs.map((d) => [d.chunk_id, d]));

        const before: ChunkInfo[] = [];
        const after: ChunkInfo[] = [];

        for (let i = Math.max(0, chunkIndex - neighbor_count); i < chunkIndex; i++) {
          const id = `${fileId}:${String(i).padStart(4, '0')}`;
          const neighbor = neighborMap.get(id);
          if (neighbor) {
            before.push({
              id: neighbor.chunk_id,
              content: neighbor.content,
              summary: neighbor.summary,
              token_count: Math.ceil(neighbor.content.length / 4),
              source: {
                file_path: neighbor.file_path,
                locator: neighbor.locator,
              },
            });
          }
        }

        for (let i = chunkIndex + 1; i <= chunkIndex + neighbor_count; i++) {
          const id = `${fileId}:${String(i).padStart(4, '0')}`;
          const neighbor = neighborMap.get(id);
          if (neighbor) {
            after.push({
              id: neighbor.chunk_id,
              content: neighbor.content,
              summary: neighbor.summary,
              token_count: Math.ceil(neighbor.content.length / 4),
              source: {
                file_path: neighbor.file_path,
                locator: neighbor.locator,
              },
            });
          }
        }

        result.neighbors = { before, after };
      }

      return result;
    }
  } catch {
    // VectorStore 未初始化，改为从文件系统读取
  }

  const { fileId, chunkIndex } = parseChunkId(chunk_id);
  const fileInfo = findFileDirectory(fileId);

  if (!fileInfo) {
    throw new Error(`Chunk not found: ${chunk_id}`);
  }

  const chunksPath = join(
    fileInfo.dirPath,
    '.fs_index',
    'documents',
    fileInfo.fileName,
    'chunks.json'
  );
  const summaryPath = join(
    fileInfo.dirPath,
    '.fs_index',
    'documents',
    fileInfo.fileName,
    'summary.json'
  );

  if (!existsSync(chunksPath)) {
    throw new Error(`Chunks file not found for: ${fileInfo.fileName}`);
  }

  const chunksData = JSON.parse(readFileSync(chunksPath, 'utf-8'));
  const summaryData = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf-8')) : null;

  const chunk = chunksData.chunks[chunkIndex];
  if (!chunk) {
    throw new Error(`Chunk index out of range: ${chunkIndex}`);
  }

  const result: { chunk: ChunkInfo; neighbors?: { before: ChunkInfo[]; after: ChunkInfo[] } } = {
    chunk: {
      id: chunk_id,
      content: chunk.content,
      summary: summaryData?.chunks?.[chunkIndex] || '',
      token_count: chunk.tokenCount || Math.ceil(chunk.content.length / 4),
      source: {
        file_path: join(fileInfo.dirPath, fileInfo.fileName),
        locator: chunk.locator,
      },
    },
  };

  if (include_neighbors) {
    const before: ChunkInfo[] = [];
    const after: ChunkInfo[] = [];

    for (let i = Math.max(0, chunkIndex - neighbor_count); i < chunkIndex; i++) {
      const c = chunksData.chunks[i];
      if (c) {
        before.push({
          id: `${fileId}:${String(i).padStart(4, '0')}`,
          content: c.content,
          summary: summaryData?.chunks?.[i] || '',
          token_count: c.tokenCount || Math.ceil(c.content.length / 4),
          source: {
            file_path: join(fileInfo.dirPath, fileInfo.fileName),
            locator: c.locator,
          },
        });
      }
    }

    for (
      let i = chunkIndex + 1;
      i <= chunkIndex + neighbor_count && i < chunksData.chunks.length;
      i++
    ) {
      const c = chunksData.chunks[i];
      if (c) {
        after.push({
          id: `${fileId}:${String(i).padStart(4, '0')}`,
          content: c.content,
          summary: summaryData?.chunks?.[i] || '',
          token_count: c.tokenCount || Math.ceil(c.content.length / 4),
          source: {
            file_path: join(fileInfo.dirPath, fileInfo.fileName),
            locator: c.locator,
          },
        });
      }
    }

    result.neighbors = { before, after };
  }

  return result;
}
