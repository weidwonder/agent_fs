import { matchMarkdownPath } from './markdown-pattern.js';
import {
  grepMarkdownContent,
  listLocalMarkdownFiles,
  readLocalMarkdownContent,
} from './local-markdown-access.js';
import { getStorageAdapter } from './search.js';

interface GrepMdInput {
  scope: string;
  query: string;
  pattern?: string;
  path?: string;
  file_id?: string;
  context_lines?: number;
  limit?: number;
  case_sensitive?: boolean;
}

export async function grepMd(input: GrepMdInput) {
  const adapter = getStorageAdapter();
  const contextLines = Math.max(0, Math.floor(input.context_lines ?? 2));
  const limit = Math.max(1, Math.floor(input.limit ?? 20));
  const files = listLocalMarkdownFiles(input.scope).filter((file) => {
    if (input.file_id && file.fileId !== input.file_id) {
      return false;
    }
    if (input.path && file.path !== input.path) {
      return false;
    }
    if (input.pattern && !matchMarkdownPath(file.path, input.pattern)) {
      return false;
    }
    return true;
  });

  const matches: Array<{
    file_id: string;
    path: string;
    line_number: number;
    line_text: string;
    before: string[];
    after: string[];
  }> = [];

  for (const file of files) {
    const content = await readLocalMarkdownContent(adapter, file);
    const fileMatches = grepMarkdownContent(
      content,
      input.query,
      contextLines,
      input.case_sensitive ?? false,
    );

    for (const match of fileMatches) {
      matches.push({
        file_id: file.fileId,
        path: file.path,
        line_number: match.lineNumber,
        line_text: match.lineText,
        before: match.before,
        after: match.after,
      });
      if (matches.length >= limit) {
        return { query: input.query, matches };
      }
    }
  }

  return { query: input.query, matches };
}
