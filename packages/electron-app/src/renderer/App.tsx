import React, { useState, useEffect } from 'react';

// IndexProgress 类型（与 @agent-fs/indexer 一致）
interface IndexProgress {
  phase: 'scan' | 'convert' | 'chunk' | 'summary' | 'embed' | 'write';
  currentFile: string;
  processed: number;
  total: number;
}

// RegisteredDirectory 类型（与 @agent-fs/core 一致）
interface RegisteredDirectory {
  path: string;
  alias: string;
  dirId: string;
  summary: string;
  lastUpdated: string;
  fileCount: number;
  chunkCount: number;
  valid: boolean;
}

declare global {
  interface Window {
    electronAPI: {
      selectDirectory: () => Promise<string | undefined>;
      startIndexing: (path: string) => Promise<{ success: boolean; metadata?: any; error?: string }>;
      getRegistry: () => Promise<{ indexedDirectories: RegisteredDirectory[] }>;
      onIndexingProgress: (callback: (progress: IndexProgress) => void) => void;
    };
  }
}

// Phase 显示名称映射
const PHASE_NAMES: Record<IndexProgress['phase'], string> = {
  scan: '扫描文件',
  convert: '转换文档',
  chunk: '切分内容',
  summary: '生成摘要',
  embed: '计算向量',
  write: '写入索引',
};

export default function App() {
  const [directories, setDirectories] = useState<RegisteredDirectory[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  useEffect(() => {
    loadRegistry();
    window.electronAPI.onIndexingProgress(setProgress);
  }, []);

  const loadRegistry = async () => {
    const registry = await window.electronAPI.getRegistry();
    setDirectories(registry.indexedDirectories?.filter(d => d.valid) || []);
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
                {PHASE_NAMES[progress.phase]}: {progress.currentFile}
              </p>
              <div className="mt-2 h-2 bg-stone-200 rounded">
                <div
                  className="h-full bg-stone-600 rounded transition-all"
                  style={{ width: `${progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}%` }}
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
              {directories.map((dir) => (
                <li key={dir.dirId} className="p-4 bg-white rounded shadow-sm">
                  <p className="font-medium text-stone-800">{dir.alias || dir.path}</p>
                  <p className="text-sm text-stone-500 truncate">{dir.path}</p>
                  <p className="text-sm text-stone-400 mt-1">
                    {dir.fileCount} 文件 · {dir.chunkCount} chunks
                  </p>
                  {dir.summary && (
                    <p className="text-sm text-stone-600 mt-2 line-clamp-2">{dir.summary}</p>
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
