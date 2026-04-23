import { readLocalMarkdownContent, sliceMarkdownByLines } from './local-markdown-access.js';
import { getStorageAdapter } from './search.js';
import { getLeafOrThrow, resolveFileRef, resolveProjectPathById } from './clue-storage.js';

export async function readClueLeaf(input: { clue_id: string; node_path: string }) {
  const adapter = getStorageAdapter();
  const clue = await adapter.clue.getClue(input.clue_id);
  if (!clue) {
    throw new Error(`Clue 不存在: ${input.clue_id}`);
  }

  const leaf = getLeafOrThrow(clue, input.node_path);
  const projectPath = resolveProjectPathById(clue.projectId);
  const file = resolveFileRef(projectPath, leaf.segment.fileId);
  const content = await readLocalMarkdownContent(adapter, file);
  const lines = content.split('\n');
  const sliced =
    leaf.segment.type === 'document'
      ? {
          content,
          lineStart: 1,
          lineEnd: lines.length,
        }
      : sliceMarkdownByLines(content, leaf.segment.anchorStart, leaf.segment.anchorEnd);

  return {
    title: leaf.name,
    content: sliced.content,
    source: {
      path: file.path,
      file_id: file.fileId,
      line_start: sliced.lineStart,
      line_end: sliced.lineEnd,
    },
  };
}
