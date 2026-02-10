import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { collectScopeContext } from './search-scope';

const createTmpDir = () => mkdtempSync(join(tmpdir(), 'agent-fs-scope-'));

const writeIndexMetadata = (dirPath: string, metadata: Record<string, unknown>) => {
  const fsIndexPath = join(dirPath, '.fs_index');
  mkdirSync(fsIndexPath, { recursive: true });
  writeFileSync(join(fsIndexPath, 'index.json'), JSON.stringify(metadata, null, 2));
};

describe('collectScopeContext', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('应优先使用 .fs_index 中的 dirId，并递归收集子目录', () => {
    const root = createTmpDir();
    tempDirs.push(root);

    const projectPath = join(root, 'project-a');
    const subPath = join(projectPath, 'sub');
    mkdirSync(subPath, { recursive: true });

    writeIndexMetadata(projectPath, {
      version: '2.0',
      projectId: 'meta-project-a',
      dirId: 'dir-root-a',
      directoryPath: projectPath,
      files: [
        { fileId: 'f1', name: 'root.md' },
      ],
      subdirectories: [
        {
          name: 'sub',
          dirId: 'dir-sub-a',
          hasIndex: true,
          summary: null,
          fileCount: 1,
          lastUpdated: new Date().toISOString(),
          fileIds: ['f2'],
        },
      ],
    });

    writeIndexMetadata(subPath, {
      version: '2.0',
      projectId: 'meta-project-a',
      dirId: 'dir-sub-a',
      directoryPath: subPath,
      files: [
        { fileId: 'f2', name: 'child.md' },
      ],
      subdirectories: [],
    });

    const context = collectScopeContext(
      [
        {
          path: projectPath,
          projectId: 'registry-project-a',
          valid: true,
          subdirectories: [],
        },
      ],
      ['registry-project-a'],
    );

    expect(context.dirIds.sort()).toEqual(['dir-root-a', 'dir-sub-a']);

    const rootFile = context.fileLookup.get('f1');
    expect(rootFile).toEqual({
      dirPath: projectPath,
      filePath: join(projectPath, 'root.md'),
      afdName: 'root.md',
    });

    const childFile = context.fileLookup.get('f2');
    expect(childFile).toEqual({
      dirPath: projectPath,
      filePath: join(subPath, 'child.md'),
      afdName: 'child.md',
    });
  });

  it('当目录缺少索引文件时，应回退到 registry 的 dirId 信息', () => {
    const root = createTmpDir();
    tempDirs.push(root);

    const projectPath = join(root, 'project-b');
    mkdirSync(projectPath, { recursive: true });

    const context = collectScopeContext(
      [
        {
          path: projectPath,
          projectId: 'registry-project-b',
          valid: true,
          subdirectories: [{ dirId: 'registry-sub-b' }],
        },
      ],
      ['registry-project-b'],
    );

    expect(context.dirIds.sort()).toEqual(['registry-project-b', 'registry-sub-b']);
  });

  it('当 cwd 在子目录时，应按 workspace 根目录解析相对路径', () => {
    const root = createTmpDir();
    tempDirs.push(root);

    const workspacePkgDir = join(root, 'packages', 'electron-app');
    mkdirSync(workspacePkgDir, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\\n  - "packages/*"\\n');

    const projectPath = join(root, 'test-data');
    mkdirSync(projectPath, { recursive: true });
    writeIndexMetadata(projectPath, {
      version: '2.0',
      projectId: 'meta-project-c',
      dirId: 'dir-root-c',
      directoryPath: projectPath,
      files: [],
      subdirectories: [],
    });

    const originalCwd = process.cwd();
    try {
      process.chdir(workspacePkgDir);
      const context = collectScopeContext(
        [
          {
            path: './test-data',
            projectId: 'registry-project-c',
            valid: true,
            subdirectories: [],
          },
        ],
        ['registry-project-c'],
      );

      expect(context.dirIds).toEqual(['dir-root-c']);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('当 workspace 与 cwd 都存在同名路径时，应优先 workspace 根目录', () => {
    const root = createTmpDir();
    tempDirs.push(root);

    const workspacePkgDir = join(root, 'packages', 'electron-app');
    const cwdShadowPath = join(workspacePkgDir, 'test-data');
    const workspacePath = join(root, 'test-data');
    mkdirSync(workspacePkgDir, { recursive: true });
    mkdirSync(cwdShadowPath, { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\\n  - "packages/*"\\n');

    writeIndexMetadata(cwdShadowPath, {
      version: '2.0',
      projectId: 'meta-project-shadow',
      dirId: 'dir-shadow',
      directoryPath: cwdShadowPath,
      files: [],
      subdirectories: [],
    });

    writeIndexMetadata(workspacePath, {
      version: '2.0',
      projectId: 'meta-project-root',
      dirId: 'dir-root-priority',
      directoryPath: workspacePath,
      files: [],
      subdirectories: [],
    });

    const originalCwd = process.cwd();
    try {
      process.chdir(workspacePkgDir);
      const context = collectScopeContext(
        [
          {
            path: './test-data',
            projectId: 'registry-project-priority',
            valid: true,
            subdirectories: [],
          },
        ],
        ['registry-project-priority'],
      );

      expect(context.dirIds).toEqual(['dir-root-priority']);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('应优先使用 index 元数据里的 afdName', () => {
    const root = createTmpDir();
    tempDirs.push(root);

    const projectPath = join(root, 'project-d');
    mkdirSync(projectPath, { recursive: true });

    writeIndexMetadata(projectPath, {
      version: '2.0',
      projectId: 'meta-project-d',
      dirId: 'dir-root-d',
      directoryPath: projectPath,
      files: [
        { fileId: 'f-report', name: 'report.xlsx', afdName: 'afd-report-2026' },
      ],
      subdirectories: [],
    });

    const context = collectScopeContext(
      [
        {
          path: projectPath,
          projectId: 'registry-project-d',
          valid: true,
          subdirectories: [],
        },
      ],
      ['registry-project-d'],
    );

    expect(context.fileLookup.get('f-report')).toEqual({
      dirPath: projectPath,
      filePath: join(projectPath, 'report.xlsx'),
      afdName: 'afd-report-2026',
    });
  });
});
