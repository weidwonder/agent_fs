import { getStorageAdapter } from './search.js';
import {
  listLocalMarkdownFiles,
  readLocalMarkdownContent,
  sliceMarkdownByLines,
} from './local-markdown-access.js';

interface ReadMdInput {
  scope: string;
  path?: string;
  file_id?: string;
  start_line?: number;
  end_line?: number;
}

export async function readMd(input: ReadMdInput) {
  if (!input.path && !input.file_id) {
    throw new Error('path 和 file_id 至少需要一个');
  }

  const file = listLocalMarkdownFiles(input.scope).find(
    (item) =>
      item.fileId === input.file_id || item.path === input.path,
  );
  if (!file) {
    throw new Error(`文件不存在: ${input.path ?? input.file_id}`);
  }

  const adapter = getStorageAdapter();
  const content = await readLocalMarkdownContent(adapter, file);
  const sliced = sliceMarkdownByLines(content, input.start_line, input.end_line);

  return {
    file_id: file.fileId,
    path: file.path,
    line_start: sliced.lineStart,
    line_end: sliced.lineEnd,
    content: sliced.content,
  };
}
