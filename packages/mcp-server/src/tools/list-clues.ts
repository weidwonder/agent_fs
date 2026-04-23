import { getStorageAdapter } from './search.js';
import { countLeaves, resolveProjectContext } from './clue-storage.js';

export async function listClues(input: { project: string }) {
  const project = resolveProjectContext(input.project);
  const summaries = await getStorageAdapter().clue.listClues(project.projectId);

  const clues = await Promise.all(
    summaries.map(async (summary) => {
      const clue =
        summary.leafCount === undefined
          ? await getStorageAdapter().clue.getClue(summary.id)
          : null;
      return {
        id: summary.id,
        name: summary.name,
        description: summary.description,
        leaf_count: summary.leafCount ?? (clue ? countLeaves(clue) : 0),
        updated_at: summary.updatedAt,
      };
    }),
  );

  return { clues };
}
