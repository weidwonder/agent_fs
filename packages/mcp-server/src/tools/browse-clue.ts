import { renderTree } from '@agent-fs/core';
import { getStorageAdapter } from './search.js';

export async function browseClue(input: {
  clue_id: string;
  node_path?: string;
  depth?: number;
}) {
  const clue = await getStorageAdapter().clue.getClue(input.clue_id);
  if (!clue) {
    throw new Error(`Clue 不存在: ${input.clue_id}`);
  }

  return {
    tree: renderTree(clue, {
      nodePath: input.node_path,
      depth: input.depth,
    }),
  };
}
