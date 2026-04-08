import { matchMarkdownPath } from './markdown-pattern.js';
import { listLocalMarkdownFiles } from './local-markdown-access.js';

interface GlobMdInput {
  scope: string;
  pattern?: string;
  limit?: number;
}

export async function globMd(input: GlobMdInput) {
  const limit = Math.max(1, Math.floor(input.limit ?? 100));
  const files = listLocalMarkdownFiles(input.scope)
    .filter((file) => matchMarkdownPath(file.path, input.pattern))
    .slice(0, limit)
    .map((file) => ({
      file_id: file.fileId,
      path: file.path,
      summary: file.summary,
    }));

  return {
    scope: input.scope,
    pattern: input.pattern ?? '**/*',
    files,
  };
}
