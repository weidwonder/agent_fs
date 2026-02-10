import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 目录选择
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  // 索引
  startIndexing: (dirPath: string) => ipcRenderer.invoke('start-indexing', dirPath),
  onIndexingProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('indexing-progress', (_event, progress) => callback(progress));
  },

  // Registry
  getRegistry: () => ipcRenderer.invoke('get-registry'),
  removeProject: (projectId: string) => ipcRenderer.invoke('remove-project', projectId),
  onProjectRemovalStatus: (callback: (status: any) => void) => {
    const listener = (_event: unknown, status: any) => callback(status);
    ipcRenderer.on('project-removal-status', listener);
    return () => {
      ipcRenderer.off('project-removal-status', listener);
    };
  },
  updateProjectSummary: (projectId: string, summary: string) =>
    ipcRenderer.invoke('update-project-summary', projectId, summary),
  getProjectMemory: (projectId: string) => ipcRenderer.invoke('get-project-memory', projectId),
  saveMemoryFile: (projectId: string, filePath: string, content: string) =>
    ipcRenderer.invoke('save-memory-file', projectId, filePath, content),

  // 配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (updates: Record<string, unknown>) =>
    ipcRenderer.invoke('save-config', updates),

  // 搜索
  search: (input: { query: string; keyword?: string; scope: string[]; top_k?: number }) =>
    ipcRenderer.invoke('search', input),
});
