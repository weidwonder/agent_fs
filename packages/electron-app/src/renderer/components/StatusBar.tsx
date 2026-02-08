import React from 'react';
import { Loader2, Database } from 'lucide-react';
import { PHASE_NAMES } from '../hooks/useIndexing';

interface StatusBarProps {
  projects: RegisteredProject[];
  indexingPath: string | null;
  progress: IndexProgress | null;
  searchMeta: SearchMeta | null;
}

export function StatusBar({
  projects,
  indexingPath,
  progress,
  searchMeta,
}: StatusBarProps) {
  const isIndexing = indexingPath !== null && progress !== null;

  const renderContent = () => {
    if (isIndexing) {
      return (
        <>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span className="shrink-0">{PHASE_NAMES[progress.phase]}</span>
            <span className="truncate max-w-[200px]">
              {progress.currentFile}
            </span>
          </div>
          <span className="shrink-0">
            {progress.processed}/{progress.total}
          </span>
        </>
      );
    }

    if (searchMeta !== null) {
      return (
        <div className="flex items-center gap-1">
          <Database className="w-3 h-3 shrink-0" />
          <span>
            搜索完成 · {searchMeta.elapsed_ms}ms · {searchMeta.total_searched}{' '}
            chunks 已搜索
          </span>
        </div>
      );
    }

    const totalFiles = projects.reduce(
      (sum, p) => sum + (p.totalFileCount ?? 0),
      0,
    );
    return (
      <span>
        {projects.length} 个项目 · {totalFiles} 个文件
      </span>
    );
  };

  return (
    <div className="h-8 bg-sidebar border-t border-sidebar-border px-4 flex items-center text-xs text-muted-foreground">
      {renderContent()}
    </div>
  );
}
