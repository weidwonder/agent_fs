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
    window.electronAPI.onIndexingProgress((next) => {
      setProgress((prev) => {
        if (!prev) {
          return next;
        }
        if (prev.total !== next.total) {
          return next;
        }
        return {
          ...next,
          processed: Math.max(prev.processed, next.processed),
        };
      });
    });
  }, []);

  const startIndexing = useCallback(async (
    dirPath: string,
    options?: { mode?: IndexingMode }
  ): Promise<{ success: boolean; metadata?: unknown; error?: string }> => {
    setIndexingPath(dirPath);
    setError(null);
    setProgress(null);
    try {
      const result = await window.electronAPI.startIndexing(dirPath, options);
      if (!result.success) {
        setError(result.error || '索引失败');
        return result;
      } else {
        onComplete?.();
        return result;
      }
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      return { success: false, error: message };
    } finally {
      setIndexingPath(null);
      setProgress(null);
    }
  }, [onComplete]);

  const selectAndIndex = useCallback(async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      await startIndexing(path, { mode: 'incremental' });
    }
  }, [startIndexing]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    indexingPath,
    isIndexing: indexingPath !== null,
    progress,
    error,
    clearError,
    startIndexing,
    selectAndIndex,
  };
}
