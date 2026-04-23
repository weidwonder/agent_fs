import type { Clue, ClueLeaf } from '../types/clue.js';
import { visitLeaves } from './tree-helpers.js';

export interface ClueLeafEntry {
  path: string;
  leaf: ClueLeaf;
}

export function listLeafEntries(clue: Clue): ClueLeafEntry[] {
  const entries: ClueLeafEntry[] = [];
  visitLeaves(clue.root, '', (leaf, leafPath) => {
    entries.push({ path: leafPath, leaf });
  });
  return entries;
}

export function listLeaves(clue: Clue): ClueLeaf[] {
  return listLeafEntries(clue).map((entry) => entry.leaf);
}
