import { getStorageAdapter } from './search.js';
import { resolveProjectContext } from './clue-storage.js';

export async function listClues(input: { project: string }) {
  const project = resolveProjectContext(input.project);
  const summaries = await getStorageAdapter().clue.listClues(project.projectId);

  const clues = summaries.map((summary) => ({
    id: summary.id,
    name: summary.name,
    description: summary.description,
    leaf_count: summary.leafCount ?? 0,
    updated_at: summary.updatedAt,
  }));

  return { clues };
}
