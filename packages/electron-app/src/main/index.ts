import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'node:path';
import { createIndexer } from '@agent-fs/indexer';
import type { IndexProgress } from '@agent-fs/indexer';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#fafafa',
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  return result.filePaths[0];
});

ipcMain.handle('start-indexing', async (_event, dirPath: string) => {
  const indexer = createIndexer({
    onProgress: (progress: IndexProgress) => {
      mainWindow?.webContents.send('indexing-progress', progress);
    },
  });

  try {
    await indexer.init();
    const metadata = await indexer.indexDirectory(dirPath);
    await indexer.dispose();
    return { success: true, metadata };
  } catch (error) {
    await indexer.dispose();
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('get-registry', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');

  const path = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(path)) {
    return { projects: [] };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
});
