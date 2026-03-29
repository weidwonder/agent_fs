import { describe, expect, it } from 'vitest';

import type { Registry } from '@agent-fs/core';
import { upsertPendingProject } from './project-registry';

function createRegistry(): Registry {
  return {
    version: '2.0',
    embeddingModel: 'embedding-2',
    embeddingDimension: 512,
    projects: [],
  };
}

describe('upsertPendingProject', () => {
  it('应为新项目创建占位入口', () => {
    const registry = createRegistry();

    const project = upsertPendingProject(
      registry,
      '/tmp/demo/project-a',
      '2026-03-28T00:00:00.000Z'
    );

    expect(project.path).toBe('/tmp/demo/project-a');
    expect(project.alias).toBe('project-a');
    expect(project.summary).toBe('索引中…');
    expect(project.totalFileCount).toBe(0);
    expect(project.totalChunkCount).toBe(0);
    expect(project.valid).toBe(true);
    expect(registry.projects).toHaveLength(1);
  });

  it('重复注册同一路径时应复用已有入口', () => {
    const registry = createRegistry();
    registry.projects.push({
      path: '/tmp/demo/project-a',
      alias: '已有项目',
      projectId: 'project-1',
      summary: '',
      lastUpdated: '',
      totalFileCount: 3,
      totalChunkCount: 12,
      subdirectories: [],
      valid: false,
    });

    const project = upsertPendingProject(
      registry,
      '/tmp/demo/project-a',
      '2026-03-28T00:00:00.000Z'
    );

    expect(project.projectId).toBe('project-1');
    expect(project.alias).toBe('已有项目');
    expect(project.totalFileCount).toBe(3);
    expect(project.totalChunkCount).toBe(12);
    expect(project.valid).toBe(true);
    expect(project.lastUpdated).toBe('2026-03-28T00:00:00.000Z');
    expect(registry.projects).toHaveLength(1);
  });
});
