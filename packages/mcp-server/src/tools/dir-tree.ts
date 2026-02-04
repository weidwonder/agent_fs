import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IndexMetadata } from '@agent-fs/core';

interface DirTreeInput {
  scope: string;
  depth?: number;
}

export async function dirTree(input: DirTreeInput) {
  const { scope, depth = 2 } = input;

  const indexPath = join(scope, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`No index found at: ${scope}`);
  }

  const metadata: IndexMetadata = JSON.parse(readFileSync(indexPath, 'utf-8'));

  return buildTree(metadata, depth);
}

function buildTree(metadata: IndexMetadata, depth: number) {
  return {
    path: metadata.directoryPath,
    summary: metadata.directorySummary,
    files: metadata.files.map((f) => ({
      path: f.name,
      summary: f.summary,
      chunk_count: f.chunkCount,
    })),
    subdirectories:
      depth > 0
        ? metadata.subdirectories.map((s) => ({
            path: s.name,
            has_index: s.hasIndex,
            summary: s.summary,
          }))
        : [],
    unsupported_files: metadata.unsupportedFiles,
  };
}
