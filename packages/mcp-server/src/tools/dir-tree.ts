import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { IndexMetadata } from '@agent-fs/core';

interface DirTreeInput {
  scope: string;
  depth?: number;
}

interface DirTreeFile {
  path: string;
  summary: string;
  chunk_count: number;
}

interface DirTreeNode {
  path: string;
  dir_id: string;
  has_index?: boolean;
  project_id?: string;
  relative_path?: string;
  parent_dir_id?: string | null;
  summary: string | null;
  stats?: {
    file_count: number;
    chunk_count: number;
    total_tokens: number;
  };
  file_count?: number;
  last_updated?: string | null;
  files: DirTreeFile[];
  subdirectories: DirTreeNode[];
  unsupported_files: string[];
}

export async function dirTree(input: DirTreeInput): Promise<DirTreeNode> {
  const { scope, depth = 2 } = input;
  const normalizedDepth = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 2;

  const indexPath = join(scope, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`No index found at: ${scope}`);
  }

  const metadata: IndexMetadata = JSON.parse(readFileSync(indexPath, 'utf-8'));

  return buildTree(metadata, normalizedDepth, true);
}

function buildTree(metadata: IndexMetadata, depth: number, root = false): DirTreeNode {
  return {
    path: root ? metadata.directoryPath : basename(metadata.directoryPath),
    dir_id: metadata.dirId,
    project_id: metadata.projectId,
    relative_path: metadata.relativePath,
    parent_dir_id: metadata.parentDirId,
    summary: metadata.directorySummary,
    stats: {
      file_count: metadata.stats.fileCount,
      chunk_count: metadata.stats.chunkCount,
      total_tokens: metadata.stats.totalTokens,
    },
    files: metadata.files.map<DirTreeFile>((f) => ({
      path: f.name,
      summary: f.summary,
      chunk_count: f.chunkCount,
    })),
    subdirectories:
      depth > 0
        ? metadata.subdirectories.map((s) => {
            const childPath = join(metadata.directoryPath, s.name);
            const childIndexPath = join(childPath, '.fs_index', 'index.json');
            if (!s.hasIndex || !existsSync(childIndexPath)) {
              return {
                path: s.name,
                dir_id: s.dirId,
                has_index: s.hasIndex,
                summary: s.summary,
                file_count: s.fileCount,
                last_updated: s.lastUpdated,
                files: [],
                subdirectories: [],
                unsupported_files: [],
              };
            }

            const childMetadata: IndexMetadata = JSON.parse(readFileSync(childIndexPath, 'utf-8'));
            return {
              ...buildTree(childMetadata, depth - 1),
              path: s.name,
              dir_id: s.dirId,
              has_index: s.hasIndex,
              file_count: s.fileCount,
              last_updated: s.lastUpdated,
            };
          })
        : [],
    unsupported_files: metadata.unsupportedFiles,
  };
}
