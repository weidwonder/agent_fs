import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Registry } from '@agent-fs/core';

interface MemoryFileInfo {
  path: string;
  size: number;
}

interface GetProjectMemoryInput {
  project: string;
}

interface GetProjectMemoryResult {
  memoryPath: string;
  exists: boolean;
  projectMd: string;
  files: MemoryFileInfo[];
}

function normalizePath(pathValue: string): string {
  return resolve(pathValue).replace(/[\\/]+$/u, '');
}

function parseRegistryOrEmpty(raw: unknown): Registry {
  if (!raw || typeof raw !== 'object') {
    return createEmptyRegistry();
  }

  const registry = raw as Partial<Registry>;
  if (!Array.isArray(registry.projects)) {
    return createEmptyRegistry();
  }

  return {
    version: registry.version ?? '2.0',
    embeddingModel: registry.embeddingModel ?? '',
    embeddingDimension: registry.embeddingDimension ?? 0,
    projects: registry.projects,
  };
}

function createEmptyRegistry(): Registry {
  return {
    version: '2.0',
    embeddingModel: '',
    embeddingDimension: 0,
    projects: [],
  };
}

function readRegistry(): Registry {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(registryPath)) {
    return createEmptyRegistry();
  }

  try {
    return parseRegistryOrEmpty(JSON.parse(readFileSync(registryPath, 'utf-8')));
  } catch {
    return createEmptyRegistry();
  }
}

function resolveProjectPath(project: string): string | null {
  const normalizedInput = normalizePath(project);
  const registry = readRegistry();

  const matchedById = registry.projects.find((item) => item.projectId === project);
  if (matchedById) {
    return normalizePath(matchedById.path);
  }

  const matchedByPath = registry.projects.find((item) => normalizePath(item.path) === normalizedInput);
  if (matchedByPath) {
    return normalizePath(matchedByPath.path);
  }

  const fsIndexPath = join(normalizedInput, '.fs_index', 'index.json');
  if (existsSync(fsIndexPath)) {
    return normalizedInput;
  }

  return null;
}

function collectMarkdownFiles(dirPath: string, prefix = ''): MemoryFileInfo[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const files: MemoryFileInfo[] = [];
  const entries = readdirSync(dirPath).sort((a, b) => a.localeCompare(b));
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath, relativePath));
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    const lowerCaseName = entry.toLowerCase();
    if (lowerCaseName.endsWith('.md') || lowerCaseName.endsWith('.markdown')) {
      files.push({
        path: relativePath,
        size: stat.size,
      });
    }
  }

  return files;
}

export async function getProjectMemory(
  input: GetProjectMemoryInput
): Promise<GetProjectMemoryResult> {
  const projectPath = resolveProjectPath(input.project);
  if (!projectPath) {
    throw new Error(`项目不存在: ${input.project}`);
  }

  const memoryPath = join(projectPath, '.fs_index', 'memory');
  const projectMdPath = join(memoryPath, 'project.md');
  const exists = existsSync(memoryPath);

  return {
    memoryPath,
    exists,
    projectMd: existsSync(projectMdPath) ? readFileSync(projectMdPath, 'utf-8') : '',
    files: exists ? collectMarkdownFiles(memoryPath) : [],
  };
}
