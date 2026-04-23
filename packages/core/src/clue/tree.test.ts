import { describe, expect, it } from 'vitest';
import type { Clue, ClueFolder, ClueLeaf } from '../types/clue.js';
import {
  addChild,
  createClue,
  findNode,
  listLeaves,
  renderTree,
  removeLeavesByFileId,
  removeNode,
  updateNode,
} from './tree.js';

function makeFolder(name: string, overrides: Partial<ClueFolder> = {}): ClueFolder {
  return {
    kind: 'folder',
    organization: 'tree',
    name,
    summary: `${name} summary`,
    children: [],
    ...overrides,
  };
}

function makeLeaf(name: string, fileId = `${name}-file`): ClueLeaf {
  return {
    kind: 'leaf',
    name,
    summary: `${name} summary`,
    segment: {
      fileId,
      type: 'range',
      anchorStart: 3,
      anchorEnd: 8,
    },
  };
}

describe('clue tree', () => {
  it('createClue 应创建不进入路径空间的 root folder', () => {
    const clue = createClue({
      projectId: 'project-1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      rootOrganization: 'timeline',
      rootTimeFormat: 'YYYY-MM',
    });

    expect(clue.id).toMatch(/^clue-/u);
    expect(clue.root.name).toBe('');
    expect(clue.root.organization).toBe('timeline');
    expect(clue.root.timeFormat).toBe('YYYY-MM');
    expect(clue.root.children).toEqual([]);
  });

  it('addChild + findNode 应支持按路径寻址', () => {
    let clue = createClue({
      projectId: 'project-1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      rootOrganization: 'tree',
    });

    clue = addChild(clue, '', makeFolder('基础认证'));
    clue = addChild(clue, '基础认证', makeLeaf('JWT 迁移', 'file-1'));

    expect(findNode(clue, '基础认证')).toMatchObject({ kind: 'folder', name: '基础认证' });
    expect(findNode(clue, '基础认证/JWT 迁移')).toMatchObject({
      kind: 'leaf',
      name: 'JWT 迁移',
    });
  });

  it('同层节点重名时 addChild 应报错', () => {
    const clue = addChild(
      createClue({
        projectId: 'project-1',
        name: '认证系统演进',
        description: '认证系统知识组织',
        principle: '按主题组织',
        rootOrganization: 'tree',
      }),
      '',
      makeFolder('基础认证')
    );

    expect(() => addChild(clue, '', makeFolder('基础认证'))).toThrow(/已存在/u);
  });

  it('updateNode 重命名后应使用新路径访问整个子树', () => {
    let clue = createClue({
      projectId: 'project-1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      rootOrganization: 'tree',
    });

    clue = addChild(clue, '', makeFolder('基础认证'));
    clue = addChild(clue, '基础认证', makeFolder('2024'));
    clue = addChild(clue, '基础认证/2024', makeLeaf('JWT 迁移', 'file-1'));

    const renamed = updateNode(clue, '基础认证', {
      name: '认证基础',
      summary: '更新后的摘要',
    });

    expect(findNode(renamed, '基础认证')).toBeNull();
    expect(findNode(renamed, '认证基础/2024/JWT 迁移')).toMatchObject({
      kind: 'leaf',
      name: 'JWT 迁移',
    });
  });

  it('removeNode 应删除整棵子树', () => {
    let clue = createClue({
      projectId: 'project-1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      rootOrganization: 'tree',
    });

    clue = addChild(clue, '', makeFolder('基础认证'));
    clue = addChild(clue, '基础认证', makeFolder('2024'));
    clue = addChild(clue, '基础认证/2024', makeLeaf('JWT 迁移', 'file-1'));

    const removed = removeNode(clue, '基础认证');
    expect(findNode(removed, '基础认证')).toBeNull();
    expect(listLeaves(removed)).toEqual([]);
  });

  it('removeLeavesByFileId 应移除匹配 leaf 并级联清理空目录', () => {
    let clue = createClue({
      projectId: 'project-1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      rootOrganization: 'tree',
    });

    clue = addChild(clue, '', makeFolder('认证'));
    clue = addChild(clue, '认证', makeFolder('2024'));
    clue = addChild(clue, '认证/2024', makeLeaf('JWT 迁移', 'file-1'));
    clue = addChild(clue, '', makeFolder('归档'));
    clue = addChild(clue, '归档', makeLeaf('保留节点', 'file-2'));

    const result = removeLeavesByFileId(clue, 'file-1');

    expect(result.removedLeaves).toBe(1);
    expect(result.removedFolders).toBe(2);
    expect(findNode(result.clue, '认证')).toBeNull();
    expect(findNode(result.clue, '归档/保留节点')).toMatchObject({
      kind: 'leaf',
      name: '保留节点',
    });
  });

  it('removeLeavesByFileId 不应删除无关的既有空目录', () => {
    const clue = createClue({
      projectId: 'project-1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      rootOrganization: 'tree',
    });

    const nextClue = addChild(
      addChild(clue, '', makeFolder('空目录')),
      '',
      makeLeaf('保留节点', 'file-2')
    );

    const result = removeLeavesByFileId(nextClue, 'file-x');

    expect(result.removedLeaves).toBe(0);
    expect(result.removedFolders).toBe(0);
    expect(findNode(result.clue, '空目录')).toMatchObject({
      kind: 'folder',
      name: '空目录',
    });
  });

  it('renderTree 应输出可读的目录树文本', () => {
    let clue: Clue = createClue({
      projectId: 'project-1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      rootOrganization: 'tree',
    });

    clue = addChild(
      clue,
      '',
      makeFolder('基础认证', {
        organization: 'timeline',
        timeFormat: 'YYYY-MM',
        summary: 'Session 到 JWT',
      })
    );
    clue = addChild(clue, '基础认证', makeLeaf('2024-03', 'file-1'));

    expect(renderTree(clue)).toContain('认证系统演进/');
    expect(renderTree(clue)).toContain('基础认证/');
    expect(renderTree(clue)).toContain('[timeline:YYYY-MM]');
    expect(renderTree(clue, { nodePath: '基础认证' })).toContain('2024-03');
  });

  it('renderTree 的 depth 应截断更深层子节点', () => {
    let clue: Clue = createClue({
      projectId: 'project-1',
      name: '认证系统演进',
      description: '认证系统知识组织',
      principle: '按主题组织',
      rootOrganization: 'tree',
    });

    clue = addChild(clue, '', makeFolder('基础认证'));
    clue = addChild(clue, '基础认证', makeFolder('2024'));
    clue = addChild(clue, '基础认证/2024', makeLeaf('JWT 迁移', 'file-1'));

    const tree = renderTree(clue, { depth: 1 });
    expect(tree).toContain('基础认证/');
    expect(tree).not.toContain('2024/');
    expect(tree).not.toContain('JWT 迁移');
  });
});
