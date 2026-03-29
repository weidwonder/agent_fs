import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Registry } from '@agent-fs/core';

export function upsertPendingProject(
  registry: Registry,
  dirPath: string,
  now: string = new Date().toISOString()
): Registry['projects'][number] {
  const alias = basename(dirPath) || dirPath;
  const existing = registry.projects.find((project) => project.path === dirPath);

  if (existing) {
    existing.alias = existing.alias || alias;
    existing.lastUpdated = existing.lastUpdated || now;
    existing.valid = true;
    return existing;
  }

  const project = {
    path: dirPath,
    alias,
    projectId: randomUUID(),
    summary: '索引中…',
    lastUpdated: now,
    totalFileCount: 0,
    totalChunkCount: 0,
    subdirectories: [],
    valid: true,
  };

  registry.projects.push(project);
  return project;
}
