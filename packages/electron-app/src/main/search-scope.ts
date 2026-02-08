import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

interface RegistrySubdirectory {
  dirId?: string;
}

interface RegistryProject {
  path: string;
  projectId: string;
  valid?: boolean;
  subdirectories?: RegistrySubdirectory[];
}

interface IndexMetadataFile {
  fileId?: string;
  name?: string;
}

interface IndexMetadataSubdirectory {
  name?: string;
  dirId?: string;
}

interface IndexMetadataLike {
  dirId?: string;
  files?: IndexMetadataFile[];
  subdirectories?: IndexMetadataSubdirectory[];
}

interface FileLookupValue {
  dirPath: string;
  filePath: string;
}

export interface SearchScopeContext {
  dirIds: string[];
  fileLookup: Map<string, FileLookupValue>;
}

const findWorkspaceRoot = (startDir: string): string | null => {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }

    const parent = resolve(current, '..');
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

export const resolveProjectPath = (rawPath: string): string => {
  if (isAbsolute(rawPath)) {
    return rawPath;
  }

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const candidates = [
    workspaceRoot,
    process.env.INIT_CWD ?? null,
    process.cwd(),
  ].filter((item): item is string => Boolean(item));

  for (const base of candidates) {
    const resolvedPath = resolve(base, rawPath);
    if (existsSync(resolvedPath) || existsSync(join(resolvedPath, '.fs_index'))) {
      return resolvedPath;
    }
  }

  return resolve(process.cwd(), rawPath);
};

const readIndexMetadata = (dirPath: string): IndexMetadataLike | null => {
  const indexPath = join(dirPath, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadataLike;
  } catch {
    return null;
  }
};

const collectFromMetadata = (
  rootProjectPath: string,
  currentDirPath: string,
  metadata: IndexMetadataLike,
  dirIds: Set<string>,
  fileLookup: Map<string, FileLookupValue>,
  visited: Set<string>
) => {
  if (visited.has(currentDirPath)) {
    return;
  }
  visited.add(currentDirPath);

  if (typeof metadata.dirId === 'string' && metadata.dirId.length > 0) {
    dirIds.add(metadata.dirId);
  }

  for (const file of metadata.files || []) {
    if (typeof file.fileId !== 'string' || file.fileId.length === 0) {
      continue;
    }
    if (typeof file.name !== 'string' || file.name.length === 0) {
      continue;
    }
    fileLookup.set(file.fileId, {
      dirPath: rootProjectPath,
      filePath: join(currentDirPath, file.name),
    });
  }

  for (const subdirectory of metadata.subdirectories || []) {
    if (typeof subdirectory.dirId === 'string' && subdirectory.dirId.length > 0) {
      dirIds.add(subdirectory.dirId);
    }

    if (typeof subdirectory.name !== 'string' || subdirectory.name.length === 0) {
      continue;
    }

    const childPath = join(currentDirPath, subdirectory.name);
    const childMetadata = readIndexMetadata(childPath);
    if (!childMetadata) {
      continue;
    }

    collectFromMetadata(rootProjectPath, childPath, childMetadata, dirIds, fileLookup, visited);
  }
};

export const collectScopeContext = (
  projects: RegistryProject[],
  selectedProjectIds: string[]
): SearchScopeContext => {
  const scopeSet = new Set(selectedProjectIds);
  const dirIds = new Set<string>();
  const fileLookup = new Map<string, FileLookupValue>();

  for (const project of projects) {
    if (project.valid === false) {
      continue;
    }
    if (!scopeSet.has(project.projectId)) {
      continue;
    }

    const projectPath = resolveProjectPath(project.path);
    const metadata = readIndexMetadata(projectPath);

    if (metadata) {
      const visited = new Set<string>();
      collectFromMetadata(projectPath, projectPath, metadata, dirIds, fileLookup, visited);
      continue;
    }

    dirIds.add(project.projectId);
    for (const subdirectory of project.subdirectories || []) {
      if (typeof subdirectory.dirId === 'string' && subdirectory.dirId.length > 0) {
        dirIds.add(subdirectory.dirId);
      }
    }
  }

  return {
    dirIds: [...dirIds],
    fileLookup,
  };
};
