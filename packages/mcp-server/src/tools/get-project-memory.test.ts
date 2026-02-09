import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = {
  homeDir: '',
};

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => state.homeDir,
  };
});

import { getProjectMemory } from './get-project-memory';

describe('getProjectMemory', () => {
  let baseDir: string;
  let projectDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'agent-fs-get-memory-'));
    state.homeDir = baseDir;
    projectDir = join(baseDir, 'project-a');

    mkdirSync(join(baseDir, '.agent_fs'), { recursive: true });
    mkdirSync(join(projectDir, '.fs_index'), { recursive: true });
    writeFileSync(join(projectDir, '.fs_index', 'index.json'), '{}');
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('应通过 projectId 返回 memory 信息', async () => {
    writeFileSync(
      join(baseDir, '.agent_fs', 'registry.json'),
      JSON.stringify(
        {
          version: '2.0',
          embeddingModel: 'mock',
          embeddingDimension: 3,
          projects: [
            {
              path: projectDir,
              alias: 'project-a',
              projectId: 'p-1',
              summary: '',
              lastUpdated: '2026-02-09T00:00:00.000Z',
              totalFileCount: 1,
              totalChunkCount: 1,
              subdirectories: [],
              valid: true,
            },
          ],
        },
        null,
        2
      )
    );

    const memoryDir = join(projectDir, '.fs_index', 'memory');
    mkdirSync(join(memoryDir, 'extend'), { recursive: true });
    writeFileSync(join(memoryDir, 'project.md'), '# 项目介绍\n');
    writeFileSync(join(memoryDir, 'extend', 'coding-style.md'), '代码风格');
    writeFileSync(join(memoryDir, 'extend', 'ignore.txt'), '不应被收集');

    const result = await getProjectMemory({ project: 'p-1' });

    expect(result.memoryPath).toBe(memoryDir);
    expect(result.exists).toBe(true);
    expect(result.projectMd).toBe('# 项目介绍\n');
    expect(result.files).toEqual([
      {
        path: 'extend/coding-style.md',
        size: Buffer.byteLength('代码风格'),
      },
      {
        path: 'project.md',
        size: Buffer.byteLength('# 项目介绍\n'),
      },
    ]);
  });

  it('应支持通过项目路径读取，即使 registry 不存在', async () => {
    const result = await getProjectMemory({ project: projectDir });

    expect(result.memoryPath).toBe(join(projectDir, '.fs_index', 'memory'));
    expect(result.exists).toBe(false);
    expect(result.projectMd).toBe('');
    expect(result.files).toEqual([]);
  });

  it('项目不存在时抛错', async () => {
    await expect(getProjectMemory({ project: join(baseDir, 'missing') })).rejects.toThrow(
      `项目不存在: ${join(baseDir, 'missing')}`
    );
  });
});
