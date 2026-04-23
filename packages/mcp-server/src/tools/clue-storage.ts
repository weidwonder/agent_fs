import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  findNode,
  type Clue,
  type ClueLeaf,
  type ClueNode,
  type IndexMetadata,
} from '@agent-fs/core';
import {
  listLocalMarkdownFiles,
  readLocalRegistry,
  resolveLocalScopeFromProject,
} from './local-markdown-access.js';

export function resolveProjectContext(project: string): { projectId: string; projectPath: string } {
  const registryPath = getRegistryPath();
  const registry = readLocalRegistry(registryPath);
  const normalizedProject = normalizePath(project);
  const matched = registry?.projects.find(
    (item) => item.projectId === project || normalizePath(item.path) === normalizedProject
  );
  if (matched) {
    return {
      projectId: matched.projectId,
      projectPath: normalizePath(matched.path),
    };
  }

  const projectPath = resolveLocalScopeFromProject(project, registryPath);
  if (!projectPath) {
    throw new Error(`项目不存在或未索引: ${project}`);
  }

  const metadata = readIndexMetadata(projectPath);
  return {
    projectId: metadata.projectId,
    projectPath,
  };
}

export function resolveProjectPathById(projectId: string): string {
  return resolveProjectContext(projectId).projectPath;
}

export function countNodes(node: ClueNode): number {
  if (node.kind === 'leaf') {
    return 1;
  }
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export function buildNodePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function getLeafOrThrow(clue: Clue, nodePath: string): ClueLeaf {
  const node = findNode(clue, nodePath);
  if (!node) {
    throw new Error(`节点不存在: ${nodePath}`);
  }
  if (node.kind !== 'leaf') {
    throw new Error(`节点不是 leaf: ${nodePath}`);
  }
  return node;
}

export function resolveFileRef(
  projectPath: string,
  fileId: string
): {
  fileId: string;
  path: string;
  absolutePath: string;
  dirPath: string;
  afdName: string;
  summary: string;
} {
  const file = listLocalMarkdownFiles(projectPath).find((item) => item.fileId === fileId);
  if (!file) {
    throw new Error(`文件不存在: ${fileId}`);
  }
  return file;
}

function getRegistryPath(): string {
  return join(homedir(), '.agent_fs', 'registry.json');
}

function readIndexMetadata(projectPath: string): IndexMetadata {
  const indexPath = join(projectPath, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`项目尚未索引: ${projectPath}`);
  }
  return JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadata;
}

function normalizePath(pathValue: string): string {
  return resolve(pathValue).replace(/[\\/]+$/u, '');
}
