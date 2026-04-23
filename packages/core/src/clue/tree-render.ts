import type { Clue, ClueFolder, ClueLeaf, ClueNode } from '../types/clue.js';
import { findNodeFromRoot, splitPath } from './tree-helpers.js';

export interface RenderTreeOptions {
  nodePath?: string;
  depth?: number;
}

export function renderTree(clue: Clue, options: RenderTreeOptions = {}): string {
  const depth = options.depth ?? Number.POSITIVE_INFINITY;
  const target = findNodeFromRoot(clue.root, options.nodePath ?? '');
  if (!target) throw new Error(`节点不存在: ${options.nodePath}`);
  if (target.kind === 'leaf') return formatLeafLine(target);

  const label =
    splitPath(options.nodePath ?? '').length === 0
      ? `${clue.name}/  # ${clue.description}`
      : formatFolderLine(target);

  const lines = [label];
  appendChildren(lines, target.children, depth, 1, '');
  return lines.join('\n');
}

function appendChildren(
  lines: string[],
  children: ClueNode[],
  depth: number,
  level: number,
  prefix: string,
): void {
  if (level > depth) return;

  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const marker = isLast ? '└── ' : '├── ';
    lines.push(`${prefix}${marker}${formatNodeLine(child)}`);
    if (child.kind === 'folder') {
      appendChildren(lines, child.children, depth, level + 1, `${prefix}${isLast ? '    ' : '│   '}`);
    }
  });
}

function formatNodeLine(node: ClueNode): string {
  return node.kind === 'folder' ? formatFolderLine(node) : formatLeafLine(node);
}

function formatFolderLine(folder: ClueFolder): string {
  const tag =
    folder.organization === 'timeline'
      ? `[timeline:${folder.timeFormat ?? 'unknown'}]`
      : '[tree]';
  return `${folder.name}/  # ${tag} ${folder.summary}`;
}

function formatLeafLine(leaf: ClueLeaf): string {
  return `${leaf.name}  # [${leaf.segment.type}] ${leaf.summary}`;
}
