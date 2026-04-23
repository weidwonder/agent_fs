import type { Clue, ClueFolder, ClueNode } from '../types/clue.js';

export interface RemoveLeavesByFileIdResult {
  clue: Clue;
  removedLeaves: number;
  removedFolders: number;
}

interface CascadeResult {
  folder: ClueFolder;
  removedLeaves: number;
  removedFolders: number;
  changed: boolean;
  removeCurrent: boolean;
}

export function removeLeavesByFileId(clue: Clue, fileId: string): RemoveLeavesByFileIdResult {
  const result = cascadeEmptyFolders(clue.root, fileId, true);
  if (!result.changed) {
    return {
      clue,
      removedLeaves: 0,
      removedFolders: 0,
    };
  }

  return {
    clue: {
      ...clue,
      root: result.folder,
      updatedAt: new Date().toISOString(),
    },
    removedLeaves: result.removedLeaves,
    removedFolders: result.removedFolders,
  };
}

function cascadeEmptyFolders(folder: ClueFolder, fileId: string, isRoot: boolean): CascadeResult {
  const nextChildren: ClueNode[] = [];
  let removedLeaves = 0;
  let removedFolders = 0;
  let changed = false;

  for (const child of folder.children) {
    if (child.kind === 'leaf') {
      if (child.segment.fileId === fileId) {
        removedLeaves += 1;
        changed = true;
        continue;
      }

      nextChildren.push(child);
      continue;
    }

    const childResult = cascadeEmptyFolders(child, fileId, false);
    removedLeaves += childResult.removedLeaves;
    removedFolders += childResult.removedFolders;
    changed ||= childResult.changed;

    if (childResult.removeCurrent) {
      removedFolders += 1;
      changed = true;
      continue;
    }

    nextChildren.push(childResult.folder);
  }

  return {
    folder: changed ? { ...folder, children: nextChildren } : folder,
    removedLeaves,
    removedFolders,
    changed,
    removeCurrent: !isRoot && changed && nextChildren.length === 0,
  };
}
