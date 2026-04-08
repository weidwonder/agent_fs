import type { StorageAdapter } from '@agent-fs/storage-adapter';
import { getPool } from '@agent-fs/storage-cloud';
import { matchMarkdownPath } from './markdown-pattern.js';

interface ScopedFileRecord {
  fileId: string;
  path: string;
  summary: string;
}

function normalizeRelativePath(path: string, basePath: string): string {
  if (!basePath || basePath === '.') {
    return path;
  }
  if (path === basePath) {
    return '';
  }
  return path.startsWith(`${basePath}/`) ? path.slice(basePath.length + 1) : path;
}

function sliceMarkdownByLines(content: string, startLine?: number, endLine?: number) {
  const lines = content.split('\n');
  const lineStart = startLine ? Math.max(1, Math.floor(startLine)) : 1;
  const lineEnd = endLine ? Math.max(lineStart, Math.floor(endLine)) : lines.length;
  return {
    content: lines.slice(lineStart - 1, lineEnd).join('\n'),
    lineStart,
    lineEnd,
  };
}

function grepMarkdownContent(
  content: string,
  query: string,
  contextLines: number,
  caseSensitive = false,
) {
  const normalizedQuery = caseSensitive ? query : query.toLowerCase();
  const lines = content.split('\n');
  const matches: Array<{ lineNumber: number; lineText: string; before: string[]; after: string[] }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    const target = caseSensitive ? lineText : lineText.toLowerCase();
    if (!target.includes(normalizedQuery)) {
      continue;
    }
    matches.push({
      lineNumber: index + 1,
      lineText,
      before: lines.slice(Math.max(0, index - contextLines), index),
      after: lines.slice(index + 1, index + 1 + contextLines),
    });
  }

  return matches;
}

export class MarkdownService {
  async globMd(tenantId: string, scope: string, pattern?: string, limit = 100) {
    const files = await this.listScopedFiles(tenantId, scope);
    return {
      scope,
      pattern: pattern ?? '**/*',
      files: files
        .filter((file) => matchMarkdownPath(file.path, pattern))
        .slice(0, Math.max(1, Math.floor(limit)))
        .map((file) => ({
          file_id: file.fileId,
          path: file.path,
          summary: file.summary,
        })),
    };
  }

  async readMd(
    tenantId: string,
    args: { scope: string; path?: string; file_id?: string; start_line?: number; end_line?: number },
    adapter: StorageAdapter,
  ) {
    const file = await this.resolveFile(tenantId, args.scope, args.path, args.file_id);
    const content = await adapter.archive.read(file.fileId, 'content.md');
    const sliced = sliceMarkdownByLines(content, args.start_line, args.end_line);
    return {
      file_id: file.fileId,
      path: file.path,
      line_start: sliced.lineStart,
      line_end: sliced.lineEnd,
      content: sliced.content,
    };
  }

  async grepMd(
    tenantId: string,
    args: {
      scope: string;
      query: string;
      pattern?: string;
      path?: string;
      file_id?: string;
      context_lines?: number;
      limit?: number;
      case_sensitive?: boolean;
    },
    adapter: StorageAdapter,
  ) {
    const contextLines = Math.max(0, Math.floor(args.context_lines ?? 2));
    const limit = Math.max(1, Math.floor(args.limit ?? 20));
    const files = await this.listScopedFiles(tenantId, args.scope);
    const matches: Array<{
      file_id: string;
      path: string;
      line_number: number;
      line_text: string;
      before: string[];
      after: string[];
    }> = [];

    for (const file of files) {
      if (args.file_id && file.fileId !== args.file_id) continue;
      if (args.path && file.path !== args.path) continue;
      if (args.pattern && !matchMarkdownPath(file.path, args.pattern)) continue;

      const content = await adapter.archive.read(file.fileId, 'content.md');
      const fileMatches = grepMarkdownContent(content, args.query, contextLines, args.case_sensitive);
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
          return { query: args.query, matches };
        }
      }
    }

    return { query: args.query, matches };
  }

  private async resolveFile(tenantId: string, scope: string, path?: string, fileId?: string) {
    if (!path && !fileId) {
      throw new Error('path 和 file_id 至少需要一个');
    }
    const files = await this.listScopedFiles(tenantId, scope);
    const file = files.find((item) => item.fileId === fileId || item.path === path);
    if (!file) {
      throw new Error(`文件不存在: ${path ?? fileId}`);
    }
    return file;
  }

  private async listScopedFiles(tenantId: string, scope: string): Promise<ScopedFileRecord[]> {
    const pool = getPool();
    const result = await pool.query(
      `WITH RECURSIVE scope_dirs AS (
         SELECT d.id, d.relative_path, true AS is_base
         FROM directories d
         WHERE d.tenant_id = $2
           AND (
             d.id = $1::uuid
             OR (d.project_id = $1::uuid AND d.parent_dir_id IS NULL)
           )
         UNION ALL
         SELECT child.id, child.relative_path, false AS is_base
         FROM directories child
         JOIN scope_dirs parent ON child.parent_dir_id = parent.id
         WHERE child.tenant_id = $2
       )
       SELECT scope_dirs.id AS dir_id,
              scope_dirs.relative_path,
              MIN(CASE WHEN scope_dirs.is_base THEN scope_dirs.relative_path END) OVER () AS base_path,
              f.id AS file_id,
              f.name,
              COALESCE(f.summary, '') AS summary
       FROM scope_dirs
       JOIN files f ON f.directory_id = scope_dirs.id
       WHERE f.status = 'indexed'
       ORDER BY scope_dirs.relative_path, f.name`,
      [scope, tenantId],
    );

    const basePath = typeof result.rows[0]?.base_path === 'string' ? result.rows[0].base_path : '.';
    return result.rows.map((row) => {
      const projectRelativePath =
        row.relative_path === '.' ? row.name : `${row.relative_path}/${row.name}`;
      return {
        fileId: row.file_id as string,
        path: normalizeRelativePath(projectRelativePath, basePath),
        summary: row.summary as string,
      };
    });
  }
}
