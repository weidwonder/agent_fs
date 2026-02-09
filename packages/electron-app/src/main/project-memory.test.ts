import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectMemoryFromRegistry, saveProjectMemoryFile } from './project-memory';

describe('project-memory', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('应返回项目 memory 内容与 markdown 文件列表', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'agent-fs-electron-memory-'));
    tempDirs.push(projectDir);

    const memoryDir = join(projectDir, '.fs_index', 'memory');
    mkdirSync(join(memoryDir, 'extend'), { recursive: true });
    writeFileSync(join(memoryDir, 'project.md'), '# 项目说明\n');
    writeFileSync(join(memoryDir, 'extend', 'coding-style.md'), '规则');
    writeFileSync(join(memoryDir, 'extend', 'ignore.txt'), 'ignore');

    const result = getProjectMemoryFromRegistry(
      [{ projectId: 'p1', path: projectDir }],
      'p1'
    );

    expect(result.exists).toBe(true);
    expect(result.projectMd).toBe('# 项目说明\n');
    expect(result.files).toEqual([
      { path: 'extend/coding-style.md', size: Buffer.byteLength('规则') },
      { path: 'project.md', size: Buffer.byteLength('# 项目说明\n') },
    ]);
  });

  it('项目不存在时应返回空结果', () => {
    const result = getProjectMemoryFromRegistry([], 'missing');
    expect(result).toEqual({
      memoryPath: '',
      exists: false,
      projectMd: '',
      files: [],
    });
  });

  it('应允许保存 memory 文件并自动创建目录', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'agent-fs-electron-memory-save-'));
    tempDirs.push(projectDir);

    const result = saveProjectMemoryFile(
      [{ projectId: 'p2', path: projectDir }],
      'p2',
      'extend/style.md',
      '## 风格'
    );

    expect(result).toEqual({ success: true });
    expect(readFileSync(join(projectDir, '.fs_index', 'memory', 'extend', 'style.md'), 'utf-8')).toBe(
      '## 风格'
    );
  });

  it('保存时路径越界应失败', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'agent-fs-electron-memory-save-'));
    tempDirs.push(projectDir);

    const result = saveProjectMemoryFile(
      [{ projectId: 'p3', path: projectDir }],
      'p3',
      '../outside.md',
      'x'
    );

    expect(result).toEqual({ success: false, error: '路径越界' });
  });
});
