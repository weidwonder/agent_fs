interface RegistrySubdirectoryLike {
  dirId?: string;
}

interface RegistryProjectLike {
  projectId: string;
  path: string;
  subdirectories?: RegistrySubdirectoryLike[];
}

interface RegistryLike {
  projects: RegistryProjectLike[];
}

export interface ProjectCleanupInput {
  projectId: string;
  projectPath: string;
  dirIds: string[];
}

export interface ProjectCleanupStatus {
  projectId: string;
  phase: 'started' | 'completed' | 'failed';
  error?: string;
}

interface RemoveProjectDependencies {
  readRegistry: () => RegistryLike;
  writeRegistry: (registry: RegistryLike) => void;
  runCleanup: (input: ProjectCleanupInput) => Promise<void>;
  onStatus?: (status: ProjectCleanupStatus) => void;
  scheduleCleanup?: (task: () => Promise<void>) => void;
}

interface RemoveProjectResult {
  success: boolean;
  cleanup_started?: boolean;
  error?: string;
}

function collectDirIds(project: RegistryProjectLike): string[] {
  const dirIds = new Set<string>();
  dirIds.add(project.projectId);

  for (const subdirectory of project.subdirectories || []) {
    if (typeof subdirectory.dirId === 'string' && subdirectory.dirId.length > 0) {
      dirIds.add(subdirectory.dirId);
    }
  }

  return [...dirIds];
}

function defaultScheduleCleanup(task: () => Promise<void>): void {
  setTimeout(() => {
    void task();
  }, 0);
}

export async function removeProjectWithBackgroundCleanup(
  projectId: string,
  dependencies: RemoveProjectDependencies
): Promise<RemoveProjectResult> {
  try {
    const registry = dependencies.readRegistry();
    const project = registry.projects.find((item) => item.projectId === projectId);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    const cleanupInput: ProjectCleanupInput = {
      projectId,
      projectPath: project.path,
      dirIds: collectDirIds(project),
    };

    const nextRegistry: RegistryLike = {
      ...registry,
      projects: registry.projects.filter((item) => item.projectId !== projectId),
    };
    dependencies.writeRegistry(nextRegistry);

    const scheduleCleanup = dependencies.scheduleCleanup || defaultScheduleCleanup;
    scheduleCleanup(async () => {
      dependencies.onStatus?.({
        projectId,
        phase: 'started',
      });

      try {
        await dependencies.runCleanup(cleanupInput);
        dependencies.onStatus?.({
          projectId,
          phase: 'completed',
        });
      } catch (error) {
        dependencies.onStatus?.({
          projectId,
          phase: 'failed',
          error: (error as Error).message,
        });
      }
    });

    return { success: true, cleanup_started: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
