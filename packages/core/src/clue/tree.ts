import { randomUUID } from 'node:crypto';
import type { Clue, ClueFolder, ClueNode } from '../types/clue.js';
import { renderTree, type RenderTreeOptions } from './tree-render.js';
export { listLeafEntries, listLeaves, type ClueLeafEntry } from './tree-leaves.js';
export { removeLeavesByFileId, type RemoveLeavesByFileIdResult } from './tree-remove.js';
import { assertNodeName, ensureUniqueName, findNodeFromRoot, splitPath } from './tree-helpers.js';

export interface CreateClueInput {
  projectId: string;
  name: string;
  description: string;
  principle: string;
  rootOrganization: 'tree' | 'timeline';
  rootTimeFormat?: string;
}

export interface UpdateNodeInput {
  name?: string;
  summary?: string;
  organization?: 'tree' | 'timeline';
  timeFormat?: string;
  anchorStart?: number;
  anchorEnd?: number;
}

export function createClue(input: CreateClueInput): Clue {
  const now = new Date().toISOString();
  return {
    id: `clue-${randomUUID().replace(/-/gu, '')}`,
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    principle: input.principle,
    createdAt: now,
    updatedAt: now,
    root: {
      kind: 'folder',
      organization: input.rootOrganization,
      timeFormat: input.rootOrganization === 'timeline' ? input.rootTimeFormat : undefined,
      name: '',
      summary: input.description,
      children: [],
    },
  };
}

export function findNode(clue: Clue, nodePath: string): ClueNode | null {
  return findNodeFromRoot(clue.root, nodePath);
}

export function addChild(clue: Clue, parentPath: string, node: ClueNode, position?: number): Clue {
  assertNodeName(node.name);
  const parent = findNode(clue, parentPath);
  if (!parent) throw new Error(`父路径不存在: ${parentPath}`);
  if (parent.kind !== 'folder') throw new Error(`目标节点不是目录: ${parentPath}`);
  ensureUniqueName(parent.children, node.name);

  const children = [...parent.children];
  if (position !== undefined && position >= 0 && position <= children.length) {
    children.splice(position, 0, node);
  } else {
    children.push(node);
  }

  return replaceFolder(clue, parentPath, { ...parent, children });
}

export function updateNode(clue: Clue, nodePath: string, updates: UpdateNodeInput): Clue {
  const segments = splitPath(nodePath);
  if (segments.length === 0) {
    throw new Error('不支持直接更新 root 节点');
  }

  const parentPath = segments.slice(0, -1).join('/');
  const currentName = segments[segments.length - 1];
  const parent = findNode(clue, parentPath);
  if (!parent || parent.kind !== 'folder') throw new Error(`父路径不存在: ${parentPath}`);

  const index = parent.children.findIndex((child) => child.name === currentName);
  if (index < 0) throw new Error(`节点不存在: ${nodePath}`);

  const current = parent.children[index];
  const next = applyUpdates(current, updates);
  ensureUniqueName(parent.children, next.name, index);

  const children = [...parent.children];
  children[index] = next;
  return replaceFolder(clue, parentPath, { ...parent, children });
}

export function removeNode(clue: Clue, nodePath: string): Clue {
  const segments = splitPath(nodePath);
  if (segments.length === 0) {
    throw new Error('不支持删除 root 节点');
  }

  const parentPath = segments.slice(0, -1).join('/');
  const targetName = segments[segments.length - 1];
  const parent = findNode(clue, parentPath);
  if (!parent || parent.kind !== 'folder') throw new Error(`父路径不存在: ${parentPath}`);

  const nextChildren = parent.children.filter((child) => child.name !== targetName);
  if (nextChildren.length === parent.children.length) {
    throw new Error(`节点不存在: ${nodePath}`);
  }

  return replaceFolder(clue, parentPath, { ...parent, children: nextChildren });
}

function replaceFolder(clue: Clue, nodePath: string, folder: ClueFolder): Clue {
  const segments = splitPath(nodePath);
  const root = replaceFolderRecursive(clue.root, segments, folder);
  return { ...clue, root, updatedAt: new Date().toISOString() };
}

function replaceFolderRecursive(
  current: ClueFolder,
  segments: string[],
  replacement: ClueFolder
): ClueFolder {
  if (segments.length === 0) {
    return replacement;
  }

  const [head, ...rest] = segments;
  const children = current.children.map((child) => {
    if (child.name !== head) return child;
    if (child.kind !== 'folder') throw new Error(`路径不是目录: ${segments.join('/')}`);
    return replaceFolderRecursive(child, rest, replacement);
  });

  return { ...current, children };
}

function applyUpdates(node: ClueNode, updates: UpdateNodeInput): ClueNode {
  const nextName = updates.name ?? node.name;
  assertNodeName(nextName);

  if (node.kind === 'folder') {
    const organization = updates.organization ?? node.organization;
    return {
      ...node,
      name: nextName,
      summary: updates.summary ?? node.summary,
      organization,
      timeFormat: organization === 'timeline' ? (updates.timeFormat ?? node.timeFormat) : undefined,
    };
  }

  return {
    ...node,
    name: nextName,
    summary: updates.summary ?? node.summary,
    segment: {
      ...node.segment,
      anchorStart: updates.anchorStart ?? node.segment.anchorStart,
      anchorEnd: updates.anchorEnd ?? node.segment.anchorEnd,
    },
  };
}

export { renderTree, type RenderTreeOptions };
