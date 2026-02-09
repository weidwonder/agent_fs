import { useCallback, useEffect, useState } from 'react';

interface MemoryState {
  memoryPath: string;
  exists: boolean;
  projectMd: string;
  files: { path: string; size: number }[];
  loading: boolean;
}

const initialState: MemoryState = {
  memoryPath: '',
  exists: false,
  projectMd: '',
  files: [],
  loading: false,
};

export function useMemory(projectId: string) {
  const [state, setState] = useState<MemoryState>(initialState);

  const load = useCallback(async () => {
    if (!projectId) {
      setState(initialState);
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    try {
      const result = await window.electronAPI.getProjectMemory(projectId);
      setState({ ...result, loading: false });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (filePath: string, content: string) => {
    const result = await window.electronAPI.saveMemoryFile(projectId, filePath, content);
    if (result.success) {
      await load();
    }
    return result;
  }, [load, projectId]);

  return {
    ...state,
    reload: load,
    save,
  };
}
