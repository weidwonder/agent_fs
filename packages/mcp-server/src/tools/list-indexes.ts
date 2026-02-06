import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Registry } from '@agent-fs/core';

export async function listIndexes() {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');

  if (!existsSync(registryPath)) {
    return { indexes: [] };
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  if (!Array.isArray(registry.projects)) {
    throw new Error('registry.json 不是 2.0 格式，请删除后重新索引');
  }

  return {
    indexes: registry.projects
      .filter((project) => project.valid)
      .map((project) => ({
        path: project.path,
        alias: project.alias,
        project_id: project.projectId,
        summary: project.summary,
        last_updated: project.lastUpdated,
        stats: {
          file_count: project.totalFileCount,
          chunk_count: project.totalChunkCount,
        },
        subdirectories: project.subdirectories.map((subdirectory) => ({
          relative_path: subdirectory.relativePath,
          dir_id: subdirectory.dirId,
          file_count: subdirectory.fileCount,
          chunk_count: subdirectory.chunkCount,
          last_updated: subdirectory.lastUpdated,
        })),
      })),
  };
}
