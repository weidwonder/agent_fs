import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

vi.mock('./search.js', () => ({
  getStorageAdapter: () => ({
    archive: {
      read: async () => {
        throw new Error('central archive should not be used in this test');
      },
    },
  }),
}));

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

import { globMd } from './glob-md.js';
import { readMd } from './read-md.js';
import { grepMd } from './grep-md.js';

describe('Markdown 原文工具', () => {
  let baseDir: string;
  let projectDir: string;

  beforeEach(() => {
    state.afdFiles.clear();
    baseDir = mkdtempSync(join(tmpdir(), 'agent-fs-markdown-tools-'));
    state.homeDir = baseDir;
    projectDir = join(baseDir, 'project');

    mkdirSync(join(projectDir, '.fs_index'), { recursive: true });
    mkdirSync(join(projectDir, 'nested', '.fs_index'), { recursive: true });

    writeFileSync(
      join(projectDir, '.fs_index', 'index.json'),
      JSON.stringify(
        {
          version: '2.0',
          createdAt: '2026-04-07T00:00:00.000Z',
          updatedAt: '2026-04-07T00:00:00.000Z',
          dirId: 'd-root',
          directoryPath: projectDir,
          directorySummary: 'root',
          projectId: 'p1',
          relativePath: '.',
          parentDirId: null,
          stats: { fileCount: 2, chunkCount: 4, totalTokens: 100 },
          files: [
            {
              name: 'cash-audit.pdf',
              afdName: 'cash-audit.pdf',
              type: 'pdf',
              size: 1,
              hash: 'sha256:a',
              fileId: 'f-cash',
              indexedAt: '2026-04-07T00:00:00.000Z',
              chunkCount: 2,
              summary: '货币资金审计',
            },
          ],
          subdirectories: [
            {
              name: 'nested',
              dirId: 'd-nested',
              hasIndex: true,
              summary: 'nested',
              fileCount: 1,
              lastUpdated: '2026-04-07T00:00:00.000Z',
              fileIds: ['f-md'],
            },
          ],
          unsupportedFiles: [],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(projectDir, 'nested', '.fs_index', 'index.json'),
      JSON.stringify(
        {
          version: '2.0',
          createdAt: '2026-04-07T00:00:00.000Z',
          updatedAt: '2026-04-07T00:00:00.000Z',
          dirId: 'd-nested',
          directoryPath: join(projectDir, 'nested'),
          directorySummary: 'nested',
          projectId: 'p1',
          relativePath: 'nested',
          parentDirId: 'd-root',
          stats: { fileCount: 1, chunkCount: 2, totalTokens: 80 },
          files: [
            {
              name: 'notes.md',
              afdName: 'notes.md',
              type: 'md',
              size: 1,
              hash: 'sha256:b',
              fileId: 'f-md',
              indexedAt: '2026-04-07T00:00:00.000Z',
              chunkCount: 2,
              summary: 'notes',
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
      `${join(projectDir, '.fs_index', 'documents')}:cash-audit.pdf:content.md`,
      '# 货币资金审计\n第一步：了解内控\n第二步：函证\n第三步：监盘',
    );
    state.afdFiles.set(
      `${join(projectDir, 'nested', '.fs_index', 'documents')}:notes.md:content.md`,
      '# 附注\n货币资金需要关注受限资金\n银行函证和余额调节表都要检查',
    );
  });

  it('globMd 应按 glob 列出 scope 内文件', async () => {
    const result = await globMd({
      scope: projectDir,
      pattern: '**/*notes*',
    });

    expect(result.files).toEqual([
      {
        file_id: 'f-md',
        path: 'nested/notes.md',
        summary: 'notes',
      },
    ]);
  });

  it('readMd 应返回指定文件的 Markdown 行片段', async () => {
    const result = await readMd({
      scope: projectDir,
      path: 'cash-audit.pdf',
      start_line: 2,
      end_line: 3,
    });

    expect(result).toEqual({
      file_id: 'f-cash',
      path: 'cash-audit.pdf',
      line_start: 2,
      line_end: 3,
      content: '第一步：了解内控\n第二步：函证',
    });
  });

  it('grepMd 应返回命中行及上下文', async () => {
    const result = await grepMd({
      scope: projectDir,
      query: '函证',
      context_lines: 1,
    });

    expect(result.matches).toEqual([
      {
        file_id: 'f-cash',
        path: 'cash-audit.pdf',
        line_number: 3,
        line_text: '第二步：函证',
        before: ['第一步：了解内控'],
        after: ['第三步：监盘'],
      },
      {
        file_id: 'f-md',
        path: 'nested/notes.md',
        line_number: 3,
        line_text: '银行函证和余额调节表都要检查',
        before: ['货币资金需要关注受限资金'],
        after: [],
      },
    ]);
  });
});
