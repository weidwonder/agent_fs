import { useState, useEffect, useCallback } from 'react';

const PHASE_NAMES: Record<IndexProgress['phase'], string> = {
  scan: '扫描文件',
  convert: '转换文档',
  chunk: '切分内容',
  summary: '生成摘要',
  embed: '计算向量',
  write: '写入索引',
};

export { PHASE_NAMES };

export function useIndexing(onComplete?: () => void) {
  const [indexingPath, setIndexingPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.onIndexingProgress(setProgress);
  }, []);

  const startIndexing = useCallback(async (dirPath: string) => {
    setIndexingPath(dirPath);
    setError(null);
    setProgress(null);
    try {
      const result = await window.electronAPI.startIndexing(dirPath);
      if (!result.success) {
        setError(result.error || '索引失败');
      } else {
        onComplete?.();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIndexingPath(null);
      setProgress(null);
    }
  }, [onComplete]);

  const selectAndIndex = useCallback(async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      await startIndexing(path);
    }
  }, [startIndexing]);

  return {
    indexingPath,
    isIndexing: indexingPath !== null,
    progress,
    error,
    startIndexing,
    selectAndIndex,
  };
}
