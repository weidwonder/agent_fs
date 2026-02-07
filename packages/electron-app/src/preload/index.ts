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
  updateProjectSummary: (projectId: string, summary: string) =>
    ipcRenderer.invoke('update-project-summary', projectId, summary),

  // 配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (updates: Record<string, unknown>) =>
    ipcRenderer.invoke('save-config', updates),

  // 搜索
  search: (input: { query: string; keyword?: string; scope: string[]; top_k?: number }) =>
    ipcRenderer.invoke('search', input),
});
