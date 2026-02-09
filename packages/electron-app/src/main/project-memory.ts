import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

interface RegistryProjectLike {
  projectId: string;
  path: string;
}

interface MemoryFileInfo {
  path: string;
  size: number;
}

interface ProjectMemoryResult {
  memoryPath: string;
  exists: boolean;
  projectMd: string;
  files: MemoryFileInfo[];
}

interface SaveMemoryResult {
  success: boolean;
  error?: string;
}

function collectMarkdownFiles(dirPath: string, prefix = ''): MemoryFileInfo[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const files: MemoryFileInfo[] = [];
  const entries = readdirSync(dirPath).sort((a, b) => a.localeCompare(b));

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;

    if (stat.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath, relativePath));
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    const lowerCaseName = entry.toLowerCase();
    if (!lowerCaseName.endsWith('.md') && !lowerCaseName.endsWith('.markdown')) {
      continue;
    }

    files.push({ path: relativePath, size: stat.size });
  }

  return files;
}

function isSafePath(baseDir: string, targetPath: string): boolean {
  const normalizedBaseDir = resolve(baseDir);
  const normalizedTargetPath = resolve(targetPath);

  if (normalizedTargetPath === normalizedBaseDir) {
    return true;
  }

  return normalizedTargetPath.startsWith(`${normalizedBaseDir}${sep}`);
}

function findProject(projects: RegistryProjectLike[], projectId: string): RegistryProjectLike | undefined {
  return projects.find((project) => project.projectId === projectId);
}

export function getProjectMemoryFromRegistry(
  projects: RegistryProjectLike[],
  projectId: string
): ProjectMemoryResult {
  const project = findProject(projects, projectId);
  if (!project) {
    return {
      memoryPath: '',
      exists: false,
      projectMd: '',
      files: [],
    };
  }

  const memoryPath = join(project.path, '.fs_index', 'memory');
  const projectMdPath = join(memoryPath, 'project.md');
  const exists = existsSync(memoryPath);

  return {
    memoryPath,
    exists,
    projectMd: existsSync(projectMdPath) ? readFileSync(projectMdPath, 'utf-8') : '',
    files: exists ? collectMarkdownFiles(memoryPath) : [],
  };
}

export function saveProjectMemoryFile(
  projects: RegistryProjectLike[],
  projectId: string,
  filePath: string,
  content: string
): SaveMemoryResult {
  const project = findProject(projects, projectId);
  if (!project) {
    return { success: false, error: '项目不存在' };
  }

  const memoryDir = join(project.path, '.fs_index', 'memory');
  const fullPath = resolve(memoryDir, filePath);

  if (!isSafePath(memoryDir, fullPath)) {
    return { success: false, error: '路径越界' };
  }

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);

  return { success: true };
}
