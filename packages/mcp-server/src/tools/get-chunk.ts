import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IndexMetadata, Registry } from '@agent-fs/core';
import { getStorageAdapter } from './search.js';

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

interface FileInfo {
  dirPath: string;
  fileName: string;
  afdName: string;
}

interface VectorChunkDoc {
  chunk_id: string;
  file_id: string;
  file_path: string;
  locator: string;
  chunk_line_start?: number;
  chunk_line_end?: number;
}

interface RuntimeProject {
  path: string;
  valid: boolean;
}

function parseChunkId(chunkId: string): { fileId: string; chunkIndex: number } {
  const parts = chunkId.split(':');
  if (parts.length < 2) {
    throw new Error(`Invalid chunk_id format: ${chunkId}`);
  }

  const chunkIndex = Number.parseInt(parts[parts.length - 1], 10);
  if (Number.isNaN(chunkIndex)) {
    throw new Error(`Invalid chunk_id format: ${chunkId}`);
  }

  return {
    fileId: parts.slice(0, -1).join(':'),
    chunkIndex,
  };
}

function findFileDirectory(fileId: string): FileInfo | null {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(registryPath)) {
    return null;
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  if (!Array.isArray(registry.projects)) {
    throw new Error('registry.json 不是 2.0 格式，请删除后重新索引');
  }
  const projects = registry.projects.map((project) => ({
    path: project.path,
    valid: project.valid,
  }));

  for (const project of projects) {
    if (!project.valid) continue;

    const found = findFileDirectoryRecursive(project.path, fileId);
    if (found) {
      return found;
    }
  }

  return null;
}

function findFileDirectoryRecursive(
  dirPath: string,
  fileId: string
): FileInfo | null {
  const indexPath = join(dirPath, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) {
    return null;
  }

  const metadata = JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadata;
  const file = metadata.files.find((item) => item.fileId === fileId);
  if (file) {
    return {
      dirPath,
      fileName: file.name,
      afdName: file.afdName ?? file.name ?? file.fileId,
    };
  }

  for (const subdirectory of metadata.subdirectories) {
    const childPath = join(dirPath, subdirectory.name);
    const found = findFileDirectoryRecursive(childPath, fileId);
    if (found) {
      return found;
    }
  }

  return null;
}

function parseLocatorRange(locator: string): { start: number; end: number } | null {
  const rangeMatch = /^(?:line|lines):(\d+)-(\d+)$/u.exec(locator.trim());
  if (rangeMatch) {
    return {
      start: Number(rangeMatch[1]),
      end: Number(rangeMatch[2]),
    };
  }

  const singleMatch = /^(?:line|lines):(\d+)$/u.exec(locator.trim());
  if (singleMatch) {
    const line = Number(singleMatch[1]);
    return { start: line, end: line };
  }

  return null;
}

function extractByLocator(markdown: string, locator: string): string {
  const range = parseLocatorRange(locator);
  if (!range) {
    return '';
  }

  const lines = markdown.split('\n');
  return lines
    .slice(Math.max(0, range.start - 1), Math.min(lines.length, range.end))
    .join('\n');
}

function extractByLineRange(
  markdown: string,
  lineStart?: number,
  lineEnd?: number
): string {
  if (!lineStart || !lineEnd || lineStart <= 0 || lineEnd < lineStart) {
    return '';
  }

  const lines = markdown.split('\n');
  return lines
    .slice(Math.max(0, lineStart - 1), Math.min(lines.length, lineEnd))
    .join('\n');
}

function buildNeighborIds(fileId: string, chunkIndex: number, neighborCount: number): string[] {
  const ids: string[] = [];

  for (let i = Math.max(0, chunkIndex - neighborCount); i < chunkIndex; i += 1) {
    ids.push(`${fileId}:${String(i).padStart(4, '0')}`);
  }

  for (let i = chunkIndex + 1; i <= chunkIndex + neighborCount; i += 1) {
    ids.push(`${fileId}:${String(i).padStart(4, '0')}`);
  }

  return ids;
}

function toChunkInfo(
  chunkId: string,
  doc: VectorChunkDoc,
  markdown: string,
  fallbackPath: string
): ChunkInfo {
  const parsedByRange = extractByLineRange(markdown, doc.chunk_line_start, doc.chunk_line_end);
  const parsedByLocator = parsedByRange ? '' : extractByLocator(markdown, doc.locator);
  const content = parsedByRange || parsedByLocator || '';

  return {
    id: chunkId,
    content,
    summary: '',
    token_count: Math.ceil(content.length / 4),
    source: {
      file_path: doc.file_path || fallbackPath,
      locator: doc.locator,
    },
  };
}

export async function getChunk(input: GetChunkInput) {
  const { chunk_id, include_neighbors = false, neighbor_count = 2 } = input;
  const { fileId, chunkIndex } = parseChunkId(chunk_id);

  const fileInfo = findFileDirectory(fileId);
  if (!fileInfo) {
    throw new Error(`Chunk not found: ${chunk_id}`);
  }

  const filePath = join(fileInfo.dirPath, fileInfo.fileName);
  const adapter = getStorageAdapter();

  const markdown = await adapter.archive.read(fileInfo.afdName, 'content.md');

  const idsToLoad = include_neighbors
    ? [chunk_id, ...buildNeighborIds(fileId, chunkIndex, neighbor_count)]
    : [chunk_id];

  const docs = (await adapter.vector.getByChunkIds(idsToLoad)) as VectorChunkDoc[];
  const docMap = new Map(docs.map((doc) => [doc.chunk_id, doc]));

  const mainDoc = docMap.get(chunk_id);
  if (!mainDoc) {
    throw new Error(`Chunk not found: ${chunk_id}`);
  }

  const result: { chunk: ChunkInfo; neighbors?: { before: ChunkInfo[]; after: ChunkInfo[] } } = {
    chunk: toChunkInfo(chunk_id, mainDoc, markdown, filePath),
  };

  if (include_neighbors) {
    const before: ChunkInfo[] = [];
    const after: ChunkInfo[] = [];

    for (let i = Math.max(0, chunkIndex - neighbor_count); i < chunkIndex; i += 1) {
      const neighborId = `${fileId}:${String(i).padStart(4, '0')}`;
      const neighborDoc = docMap.get(neighborId);
      if (!neighborDoc) continue;
      before.push(toChunkInfo(neighborId, neighborDoc, markdown, filePath));
    }

    for (let i = chunkIndex + 1; i <= chunkIndex + neighbor_count; i += 1) {
      const neighborId = `${fileId}:${String(i).padStart(4, '0')}`;
      const neighborDoc = docMap.get(neighborId);
      if (!neighborDoc) continue;
      after.push(toChunkInfo(neighborId, neighborDoc, markdown, filePath));
    }

    result.neighbors = { before, after };
  }

  return result;
}
