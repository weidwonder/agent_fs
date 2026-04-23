import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalClueAdapter } from '@agent-fs/storage-adapter';

const state = {
  homeDir: '',
  afdFiles: new Map<string, string>(),
};

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => state.homeDir,
  };
});

vi.mock('@agent-fs/storage', () => ({
  createAFDStorage: ({ documentsDir }: { documentsDir: string }) => ({
    readText: async (fileId: string, fileName: string) => {
      const content = state.afdFiles.get(`${documentsDir}:${fileId}:${fileName}`);
      if (!content) {
        throw new Error(`missing archive: ${documentsDir}/${fileId}/${fileName}`);
      }
      return content;
    },
  }),
}));

import { __resetSearchServicesForTest, setStorageAdapter } from './search.js';
import {
  clueAddFolder,
  clueAddLeaf,
  clueCreate,
  clueDelete,
  clueGetStructure,
  clueRemoveNode,
  clueUpdateNode,
} from './clue-builder.js';
import { listClues } from './list-clues.js';
import { browseClue } from './browse-clue.js';
import { readClueLeaf } from './read-clue-leaf.js';

describe('Clue tools', () => {
  let baseDir: string;
  let projectDir: string;
  let registryPath: string;

  beforeEach(async () => {
    state.afdFiles.clear();
    baseDir = mkdtempSync(join(tmpdir(), 'agent-fs-clue-tools-'));
    state.homeDir = baseDir;
    projectDir = join(baseDir, 'project');
    registryPath = join(baseDir, '.agent_fs', 'registry.json');

    mkdirSync(join(baseDir, '.agent_fs'), { recursive: true });
    mkdirSync(join(projectDir, '.fs_index', 'documents'), { recursive: true });

    writeFileSync(
      registryPath,
      JSON.stringify(
        {
          version: '2.0',
          embeddingModel: 'mock',
          embeddingDimension: 3,
          projects: [
            {
              path: projectDir,
              alias: 'project',
              projectId: 'p1',
              summary: 'test',
              lastUpdated: '2026-04-23T00:00:00.000Z',
              totalFileCount: 1,
              totalChunkCount: 2,
              subdirectories: [],
              valid: true,
            },
          ],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(projectDir, '.fs_index', 'index.json'),
      JSON.stringify(
        {
          version: '2.0',
          createdAt: '2026-04-23T00:00:00.000Z',
          updatedAt: '2026-04-23T00:00:00.000Z',
          dirId: 'p1',
          directoryPath: projectDir,
          directorySummary: 'test',
          projectId: 'p1',
          relativePath: '.',
          parentDirId: null,
          stats: { fileCount: 1, chunkCount: 2, totalTokens: 20 },
          files: [
            {
              name: 'auth.md',
              afdName: 'auth.md',
              type: 'md',
              size: 10,
              hash: 'sha256:auth',
              fileId: 'f1',
              indexedAt: '2026-04-23T00:00:00.000Z',
              chunkCount: 2,
              summary: 'auth summary',
            },
          ],
          subdirectories: [],
          unsupportedFiles: [],
        },
        null,
        2,
      ),
    );

    state.afdFiles.set(
      `${join(projectDir, '.fs_index', 'documents')}:auth.md:content.md`,
      '# Auth\n第一行\n第二行\n第三行',
    );

    const clueAdapter = new LocalClueAdapter({ registryPath });
    await clueAdapter.init();

    setStorageAdapter({
      clue: clueAdapter,
      archive: {
        read: async () => {
          throw new Error('archive fallback should not be used');
        },
      },
    } as any);
  });

  afterEach(() => {
    __resetSearchServicesForTest();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('Builder + Consumer 工具应支持创建、浏览与读取 Clue', async () => {
    const created = await clueCreate({
      project: projectDir,
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      root_organization: 'tree',
    });

    await clueAddFolder({
      clue_id: created.clue_id,
      parent_path: '',
      name: '基础认证',
      summary: 'Session 到 JWT',
      organization: 'timeline',
      time_format: 'YYYY-MM',
    });

    await clueAddLeaf({
      clue_id: created.clue_id,
      parent_path: '基础认证',
      name: '2024-03',
      summary: 'JWT 迁移',
      file_id: 'f1',
      segment_type: 'range',
      anchor_start: 2,
      anchor_end: 3,
    });

    const listed = await listClues({ project: projectDir });
    expect(listed.clues).toEqual([
      expect.objectContaining({
        id: created.clue_id,
        name: '认证系统演进',
        leaf_count: 1,
      }),
    ]);

    const tree = await browseClue({ clue_id: created.clue_id });
    expect(tree.tree).toContain('认证系统演进/');
    expect(tree.tree).toContain('基础认证/');
    expect(tree.tree).toContain('2024-03');

    const leaf = await readClueLeaf({
      clue_id: created.clue_id,
      node_path: '基础认证/2024-03',
    });
    expect(leaf.title).toBe('2024-03');
    expect(leaf.content).toBe('第一行\n第二行');
    expect(leaf.source).toEqual({
      path: 'auth.md',
      file_id: 'f1',
      line_start: 2,
      line_end: 3,
    });
  });

  it('Builder 工具应支持更新、删除节点和删除 clue', async () => {
    const created = await clueCreate({
      project: 'p1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      root_organization: 'tree',
    });

    await clueAddFolder({
      clue_id: created.clue_id,
      parent_path: '',
      name: '基础认证',
      summary: 'Session 到 JWT',
      organization: 'tree',
    });
    await clueAddLeaf({
      clue_id: created.clue_id,
      parent_path: '基础认证',
      name: 'JWT 迁移',
      summary: '旧摘要',
      file_id: 'f1',
      segment_type: 'range',
      anchor_start: 2,
      anchor_end: 3,
    });

    await clueUpdateNode({
      clue_id: created.clue_id,
      node_path: '基础认证/JWT 迁移',
      name: 'JWT 迁移方案',
      summary: '新摘要',
      anchor_start: 3,
      anchor_end: 4,
    });

    const structure = await clueGetStructure({ clue_id: created.clue_id });
    expect(structure.tree).toContain('JWT 迁移方案');
    expect(structure.tree).toContain('新摘要');

    const removed = await clueRemoveNode({
      clue_id: created.clue_id,
      node_path: '基础认证',
    });
    expect(removed.removed_count).toBe(2);

    const deleted = await clueDelete({ clue_id: created.clue_id });
    expect(deleted).toEqual({ success: true });
    expect((await listClues({ project: 'p1' })).clues).toEqual([]);
  });
});
