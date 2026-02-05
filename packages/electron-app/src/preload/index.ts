import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  startIndexing: (dirPath: string) => ipcRenderer.invoke('start-indexing', dirPath),
  getRegistry: () => ipcRenderer.invoke('get-registry'),
  onIndexingProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('indexing-progress', (_event, progress) => callback(progress));
  },
});
