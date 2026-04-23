import type { ClueFolder, ClueLeaf, ClueNode } from '../types/clue.js';

export function splitPath(nodePath: string): string[] {
  return nodePath.split('/').map((segment) => segment.trim()).filter(Boolean);
}

export function findNodeFromRoot(root: ClueFolder, nodePath: string): ClueNode | null {
  const segments = splitPath(nodePath);
  let current: ClueNode = root;

  for (const segment of segments) {
    if (current.kind !== 'folder') return null;
    const next: ClueNode | undefined = current.children.find((child) => child.name === segment);
    if (!next) return null;
    current = next;
  }

  return current;
}

export function ensureUniqueName(children: ClueNode[], name: string, skipIndex = -1): void {
  if (children.some((child, index) => index !== skipIndex && child.name === name)) {
    throw new Error(`同层节点名称已存在: ${name}`);
  }
}

export function assertNodeName(name: string): void {
  if (!name.trim()) throw new Error('节点名称不能为空');
  if (name.includes('/')) throw new Error('节点名称不能包含 "/"');
}

export function visitLeaves(
  node: ClueNode,
  parentPath: string,
  visit: (leaf: ClueLeaf, leafPath: string) => void,
): void {
  if (node.kind === 'leaf') {
    visit(node, parentPath);
    return;
  }

  node.children.forEach((child) => {
    const nextPath = parentPath ? `${parentPath}/${child.name}` : child.name;
    visitLeaves(child, nextPath, visit);
  });
}
