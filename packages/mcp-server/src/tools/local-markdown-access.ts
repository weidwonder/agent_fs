import { existsSync, readFileSync } from 'node:fs';
import { relative, join, resolve } from 'node:path';
import type { IndexMetadata, Registry } from '@agent-fs/core';
import { createAFDStorage } from '@agent-fs/storage';
import type { StorageAdapter } from '@agent-fs/storage-adapter';

export interface LocalMarkdownFileRef {
  fileId: string;
  path: string;
  absolutePath: string;
  dirPath: string;
  afdName: string;
  summary: string;
}

function normalizeLocalPath(pathValue: string): string {
  return resolve(pathValue).replace(/[\\/]+$/u, '');
}

function readIndexMetadata(dirPath: string): IndexMetadata {
  const indexPath = join(dirPath, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`No index found at: ${dirPath}`);
  }
  return JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadata;
}

function collectFilesRecursive(scopePath: string, dirPath: string): LocalMarkdownFileRef[] {
  const metadata = readIndexMetadata(dirPath);
  const files = metadata.files.map<LocalMarkdownFileRef>((file) => {
    const absolutePath = join(dirPath, file.name);
    return {
      fileId: file.fileId,
      path: relative(scopePath, absolutePath).replaceAll('\\', '/'),
      absolutePath,
      dirPath,
      afdName: file.afdName ?? file.name ?? file.fileId,
      summary: file.summary,
    };
  });

  for (const subdirectory of metadata.subdirectories) {
    if (!subdirectory.hasIndex) {
      continue;
    }
    files.push(...collectFilesRecursive(scopePath, join(dirPath, subdirectory.name)));
  }

  return files;
}

export function listLocalMarkdownFiles(scope: string): LocalMarkdownFileRef[] {
  const normalizedScope = normalizeLocalPath(scope);
  return collectFilesRecursive(normalizedScope, normalizedScope).sort((a, b) =>
    a.path.localeCompare(b.path, 'zh-CN'),
  );
}

export function readLocalRegistry(registryPath: string): Registry | null {
  if (!existsSync(registryPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  } catch {
    return null;
  }
}

export function resolveLocalScopeFromProject(project: string, registryPath: string): string | null {
  const normalizedProject = normalizeLocalPath(project);
  const registry = readLocalRegistry(registryPath);
  const matched = registry?.projects.find(
    (item) =>
      item.projectId === project || normalizeLocalPath(item.path) === normalizedProject,
  );
  if (matched) {
    return normalizeLocalPath(matched.path);
  }
  if (existsSync(join(normalizedProject, '.fs_index', 'index.json'))) {
    return normalizedProject;
  }
  return null;
}

export async function readLocalMarkdownContent(
  adapter: StorageAdapter,
  file: LocalMarkdownFileRef,
): Promise<string> {
  const projectArchive = createAFDStorage({
    documentsDir: join(file.dirPath, '.fs_index', 'documents'),
  });

  try {
    return await projectArchive.readText(file.afdName, 'content.md');
  } catch (projectError) {
    try {
      return await adapter.archive.read(file.fileId, 'content.md');
    } catch {
      const detail = projectError instanceof Error ? projectError.message : String(projectError);
      throw new Error(`AFD 原文不存在: ${file.absolutePath}${detail ? ` (${detail})` : ''}`);
    }
  }
}

export function sliceMarkdownByLines(
  content: string,
  startLine?: number,
  endLine?: number,
): { content: string; lineStart: number; lineEnd: number } {
  const lines = content.split('\n');
  const lineStart = startLine ? Math.max(1, Math.floor(startLine)) : 1;
  const lineEnd = endLine
    ? Math.max(lineStart, Math.floor(endLine))
    : lines.length;

  return {
    content: lines.slice(lineStart - 1, lineEnd).join('\n'),
    lineStart,
    lineEnd,
  };
}

export interface MarkdownMatch {
  lineNumber: number;
  lineText: string;
  before: string[];
  after: string[];
}

export function grepMarkdownContent(
  content: string,
  query: string,
  contextLines: number,
  caseSensitive = false,
): MarkdownMatch[] {
  const normalizedQuery = caseSensitive ? query : query.toLowerCase();
  const lines = content.split('\n');
  const matches: MarkdownMatch[] = [];

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
