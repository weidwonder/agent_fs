import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Registry } from '@agent-fs/core';

export async function listIndexes() {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');

  if (!existsSync(registryPath)) {
    return { indexes: [] };
  }

  const registry: Registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

  return {
    indexes: registry.indexedDirectories
      .filter((d) => d.valid)
      .map((d) => ({
        path: d.path,
        alias: d.alias,
        summary: d.summary,
        last_updated: d.lastUpdated,
        stats: {
          file_count: d.fileCount,
          chunk_count: d.chunkCount,
        },
      })),
  };
}
