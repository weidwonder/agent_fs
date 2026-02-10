import { describe, expect, it, vi } from 'vitest';

import { removeProjectWithBackgroundCleanup } from './project-removal';

describe('removeProjectWithBackgroundCleanup', () => {
  it('应先移除 registry 条目，再异步触发清理任务', async () => {
    const registry = {
      projects: [
        {
          projectId: 'p1',
          path: '/tmp/project-1',
          subdirectories: [{ dirId: 'd1' }, { dirId: 'd2' }],
        },
        {
          projectId: 'p2',
          path: '/tmp/project-2',
          subdirectories: [],
        },
      ],
    };

    let scheduledTask: (() => Promise<void>) | null = null;
    const writeRegistry = vi.fn();
    const runCleanup = vi.fn().mockResolvedValue(undefined);
    const onStatus = vi.fn();

    const result = await removeProjectWithBackgroundCleanup('p1', {
      readRegistry: () => registry,
      writeRegistry,
      runCleanup,
      onStatus,
      scheduleCleanup: (task) => {
        scheduledTask = task;
      },
    });

    expect(result).toEqual({ success: true, cleanup_started: true });
    expect(writeRegistry).toHaveBeenCalledTimes(1);
    expect(writeRegistry).toHaveBeenCalledWith({
      projects: [
        {
          projectId: 'p2',
          path: '/tmp/project-2',
          subdirectories: [],
        },
      ],
    });

    expect(runCleanup).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
    expect(scheduledTask).not.toBeNull();

    await scheduledTask?.();

    expect(runCleanup).toHaveBeenCalledTimes(1);
    expect(runCleanup).toHaveBeenCalledWith({
      projectId: 'p1',
      projectPath: '/tmp/project-1',
      dirIds: ['p1', 'd1', 'd2'],
    });
    expect(onStatus.mock.calls.map((call) => call[0].phase)).toEqual(['started', 'completed']);
  });

  it('项目不存在时应直接失败且不触发清理', async () => {
    const writeRegistry = vi.fn();
    const runCleanup = vi.fn();

    const result = await removeProjectWithBackgroundCleanup('missing', {
      readRegistry: () => ({ projects: [] }),
      writeRegistry,
      runCleanup,
    });

    expect(result).toEqual({ success: false, error: '项目不存在' });
    expect(writeRegistry).not.toHaveBeenCalled();
    expect(runCleanup).not.toHaveBeenCalled();
  });
});
