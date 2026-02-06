export interface RegistrySubdirectory {
  dirId: string;
  relativePath: string;
}

export interface RegistryProject {
  projectId: string;
  subdirectories: RegistrySubdirectory[];
}

export class DirectoryResolver {
  constructor(private readonly projects: RegistryProject[]) {
    this.projects = projects;
  }

  expandDirIds(dirIds: string[]): string[] {
    const result = new Set<string>(dirIds);

    for (const dirId of dirIds) {
      const project = this.findProjectContaining(dirId);
      if (!project) continue;

      if (dirId === project.projectId) {
        for (const subdirectory of project.subdirectories) {
          result.add(subdirectory.dirId);
        }
        continue;
      }

      const current = project.subdirectories.find((item) => item.dirId === dirId);
      if (!current) continue;

      const currentPath = normalizeRelativePath(current.relativePath);
      for (const subdirectory of project.subdirectories) {
        const candidatePath = normalizeRelativePath(subdirectory.relativePath);
        if (isDescendantOrSelf(candidatePath, currentPath)) {
          result.add(subdirectory.dirId);
        }
      }
    }

    return [...result];
  }

  private findProjectContaining(dirId: string): RegistryProject | undefined {
    return this.projects.find(
      (project) =>
        project.projectId === dirId ||
        project.subdirectories.some((subdirectory) => subdirectory.dirId === dirId)
    );
  }
}

function normalizeRelativePath(path: string): string {
  return path.replace(/^\/+|\/+$/gu, '');
}

function isDescendantOrSelf(candidatePath: string, basePath: string): boolean {
  if (!basePath) {
    return true;
  }
  return candidatePath === basePath || candidatePath.startsWith(`${basePath}/`);
}
