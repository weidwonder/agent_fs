import {
  addChild,
  createClue,
  findNode,
  removeNode,
  renderTree,
  updateNode,
  type Clue,
  type ClueNode,
} from '@agent-fs/core';
import { getStorageAdapter } from './search.js';
import { buildNodePath, countNodes, resolveProjectContext } from './clue-storage.js';

interface ClueCreateInput {
  project: string;
  name: string;
  description: string;
  principle: string;
  root_organization: 'tree' | 'timeline';
  root_time_format?: string;
}

export async function clueCreate(input: ClueCreateInput) {
  const project = resolveProjectContext(input.project);
  const clue = createClue({
    projectId: project.projectId,
    name: input.name,
    description: input.description,
    principle: input.principle,
    rootOrganization: input.root_organization,
    rootTimeFormat: input.root_time_format,
  });

  await getStorageAdapter().clue.saveClue(clue);
  return { clue_id: clue.id };
}

export async function clueDelete(input: { clue_id: string }) {
  await getStorageAdapter().clue.deleteClue(input.clue_id);
  return { success: true };
}

export async function clueAddFolder(input: {
  clue_id: string;
  parent_path: string;
  name: string;
  summary: string;
  organization: 'tree' | 'timeline';
  time_format?: string;
  position?: number;
}) {
  const clue = await getClueOrThrow(input.clue_id);
  const updated = addChild(
    clue,
    input.parent_path,
    {
      kind: 'folder',
      name: input.name,
      summary: input.summary,
      organization: input.organization,
      timeFormat: input.organization === 'timeline' ? input.time_format : undefined,
      children: [],
    },
    input.position,
  );

  await getStorageAdapter().clue.saveClue(updated);
  return { path: buildNodePath(input.parent_path, input.name) };
}

export async function clueAddLeaf(input: {
  clue_id: string;
  parent_path: string;
  name: string;
  summary: string;
  file_id: string;
  segment_type: 'document' | 'range';
  anchor_start?: number;
  anchor_end?: number;
  position?: number;
}) {
  const clue = await getClueOrThrow(input.clue_id);
  const updated = addChild(
    clue,
    input.parent_path,
    {
      kind: 'leaf',
      name: input.name,
      summary: input.summary,
      segment: {
        fileId: input.file_id,
        type: input.segment_type,
        anchorStart: input.anchor_start,
        anchorEnd: input.anchor_end,
      },
    },
    input.position,
  );

  await getStorageAdapter().clue.saveClue(updated);
  return { path: buildNodePath(input.parent_path, input.name) };
}

export async function clueUpdateNode(input: {
  clue_id: string;
  node_path: string;
  name?: string;
  summary?: string;
  organization?: 'tree' | 'timeline';
  time_format?: string;
  anchor_start?: number;
  anchor_end?: number;
}) {
  const clue = await getClueOrThrow(input.clue_id);
  const updated = updateNode(clue, input.node_path, {
    name: input.name,
    summary: input.summary,
    organization: input.organization,
    timeFormat: input.time_format,
    anchorStart: input.anchor_start,
    anchorEnd: input.anchor_end,
  });

  await getStorageAdapter().clue.saveClue(updated);
  return { success: true };
}

export async function clueRemoveNode(input: { clue_id: string; node_path: string }) {
  const clue = await getClueOrThrow(input.clue_id);
  const target = findNode(clue, input.node_path);
  if (!target) {
    throw new Error(`节点不存在: ${input.node_path}`);
  }

  const updated = removeNode(clue, input.node_path);
  await getStorageAdapter().clue.saveClue(updated);
  return { removed_count: countNodes(target as ClueNode) };
}

export async function clueGetStructure(input: { clue_id: string; node_path?: string }) {
  const clue = await getClueOrThrow(input.clue_id);
  return {
    tree: renderTree(clue, {
      nodePath: input.node_path,
    }),
  };
}

async function getClueOrThrow(clueId: string): Promise<Clue> {
  const clue = await getStorageAdapter().clue.getClue(clueId);
  if (!clue) {
    throw new Error(`Clue 不存在: ${clueId}`);
  }
  return clue;
}
