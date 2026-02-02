# [G2] Electron App - 桌面应用实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Electron 桌面应用，提供索引管理 GUI

**Architecture:** Electron + React，极简档案馆风格

**Tech Stack:** Electron, React, Vite, TailwindCSS

**依赖:** [F] indexer

**被依赖:** 无（终端应用）

---

## 成功标准

- [ ] 应用可启动
- [ ] 能选择目录并开始索引
- [ ] 进度条正确显示
- [ ] 能查看已索引目录列表
- [ ] 能编辑配置
- [ ] 能清理无效索引
- [ ] 打包成可执行文件

---

## Task 1: 创建 Electron 项目结构

**Files:**
- Create: `packages/electron-app/package.json`
- Create: `packages/electron-app/electron.vite.config.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/electron-app/src/{main,preload,renderer}`

**Step 2: 创建 package.json**

```json
{
  "name": "@agent-fs/electron-app",
  "version": "0.1.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-builder"
  },
  "dependencies": {
    "@agent-fs/core": "workspace:*",
    "@agent-fs/indexer": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "electron": "^28.0.0",
    "electron-builder": "^24.9.0",
    "electron-vite": "^2.0.0",
    "postcss": "^8.4.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

**Step 3: 创建 electron.vite.config.ts**

```typescript
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
    },
  },
});
```

---

## Task 2: 实现 Main 进程

**Files:**
- Create: `packages/electron-app/src/main/index.ts`

```typescript
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'node:path';
import { createIndexer } from '@agent-fs/indexer';

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

// IPC Handlers

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  return result.filePaths[0];
});

ipcMain.handle('start-indexing', async (_event, dirPath: string) => {
  const indexer = createIndexer({
    onProgress: (progress) => {
      mainWindow?.webContents.send('indexing-progress', progress);
    },
  });

  try {
    await indexer.init();
    const metadata = await indexer.indexDirectory(dirPath);
    await indexer.dispose();
    return { success: true, metadata };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('get-registry', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');

  const path = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(path)) {
    return { indexedDirectories: [] };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
});
```

---

## Task 3: 实现 Preload 脚本

**Files:**
- Create: `packages/electron-app/src/preload/index.ts`

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  startIndexing: (dirPath: string) => ipcRenderer.invoke('start-indexing', dirPath),
  getRegistry: () => ipcRenderer.invoke('get-registry'),
  onIndexingProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('indexing-progress', (_event, progress) => callback(progress));
  },
});
```

---

## Task 4: 实现 React 前端

**Files:**
- Create: `packages/electron-app/src/renderer/index.html`
- Create: `packages/electron-app/src/renderer/main.tsx`
- Create: `packages/electron-app/src/renderer/App.tsx`

**index.html:**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent FS</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

**main.tsx:**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**App.tsx:**

```tsx
import React, { useState, useEffect } from 'react';

declare global {
  interface Window {
    electronAPI: {
      selectDirectory: () => Promise<string>;
      startIndexing: (path: string) => Promise<{ success: boolean; metadata?: any; error?: string }>;
      getRegistry: () => Promise<{ indexedDirectories: any[] }>;
      onIndexingProgress: (callback: (progress: any) => void) => void;
    };
  }
}

export default function App() {
  const [directories, setDirectories] = useState<any[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState<any>(null);

  useEffect(() => {
    loadRegistry();
    window.electronAPI.onIndexingProgress(setProgress);
  }, []);

  const loadRegistry = async () => {
    const registry = await window.electronAPI.getRegistry();
    setDirectories(registry.indexedDirectories || []);
  };

  const handleSelectDirectory = async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      setIndexing(true);
      const result = await window.electronAPI.startIndexing(path);
      setIndexing(false);
      setProgress(null);
      if (result.success) {
        loadRegistry();
      } else {
        alert('索引失败: ' + result.error);
      }
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-light text-stone-800">Agent FS</h1>
        <p className="text-stone-500">文档智能索引</p>
      </header>

      <main>
        <section className="mb-8">
          <button
            onClick={handleSelectDirectory}
            disabled={indexing}
            className="px-4 py-2 bg-stone-800 text-white rounded hover:bg-stone-700 disabled:opacity-50"
          >
            {indexing ? '索引中...' : '选择文件夹'}
          </button>

          {progress && (
            <div className="mt-4 p-4 bg-white rounded shadow-sm">
              <p className="text-sm text-stone-600">
                {progress.phase}: {progress.currentFile}
              </p>
              <div className="mt-2 h-2 bg-stone-200 rounded">
                <div
                  className="h-full bg-stone-600 rounded transition-all"
                  style={{ width: `${(progress.processed / progress.total) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {progress.processed} / {progress.total}
              </p>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-medium text-stone-700 mb-4">已索引目录</h2>
          {directories.length === 0 ? (
            <p className="text-stone-400">暂无索引</p>
          ) : (
            <ul className="space-y-2">
              {directories.map((dir, i) => (
                <li key={i} className="p-4 bg-white rounded shadow-sm">
                  <p className="font-medium text-stone-800">{dir.alias || dir.path}</p>
                  <p className="text-sm text-stone-500 truncate">{dir.path}</p>
                  <p className="text-sm text-stone-400 mt-1">
                    {dir.fileCount} 文件 · {dir.chunkCount} chunks
                  </p>
                  {dir.summary && (
                    <p className="text-sm text-stone-600 mt-2">{dir.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
```

---

## Task 5: 配置 TailwindCSS

**Files:**
- Create: `packages/electron-app/tailwind.config.js`
- Create: `packages/electron-app/postcss.config.js`
- Create: `packages/electron-app/src/renderer/index.css`

**tailwind.config.js:**

```javascript
export default {
  content: ['./src/renderer/**/*.{html,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

**postcss.config.js:**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**index.css:**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

---

## Task 6: 配置打包

**Files:**
- Create: `packages/electron-app/electron-builder.yml`

```yaml
appId: com.agent-fs.app
productName: Agent FS
directories:
  buildResources: resources
  output: dist
files:
  - out/**/*
mac:
  target: dmg
  category: public.app-category.productivity
win:
  target: nsis
linux:
  target: AppImage
```

---

## 完成检查清单

- [ ] Electron 框架搭建
- [ ] Main/Preload/Renderer 通信
- [ ] 目录选择和索引
- [ ] 进度显示
- [ ] 已索引目录列表
- [ ] 打包配置

---

## 输出接口

```bash
# 开发模式
cd packages/electron-app
pnpm dev

# 打包
pnpm build
pnpm package
```
