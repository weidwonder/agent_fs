import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { IndexProgress as IndexProgressBar } from './IndexProgress';

interface ProjectOverviewDialogProps {
  project: RegisteredProject | null;
  open: boolean;
  disabled?: boolean;
  indexingPath: string | null;
  currentMode: IndexingMode | null;
  progress: IndexProgress | null;
  onOpenChange: (open: boolean) => void;
  onRunAction: (
    dirPath: string,
    mode: IndexingMode
  ) => Promise<{ success: boolean; error?: string }>;
}

interface BackfillCoverageIncrement {
  chunkGenerated: number;
  documentGenerated: number;
  directoryGenerated: number;
}

const EMPTY_BACKFILL_INCREMENT: BackfillCoverageIncrement = {
  chunkGenerated: 0,
  documentGenerated: 0,
  directoryGenerated: 0,
};

export const PROJECT_OVERVIEW_DIALOG_CONTENT_CLASSNAME =
  'flex max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[85vh]';

export const PROJECT_OVERVIEW_DIALOG_BODY_CLASSNAME =
  'min-h-0 flex-1 overflow-y-auto px-6 py-4';

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDateTime(value: string): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN');
}

function formatLogLine(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const timestamp =
      typeof parsed.timestamp === 'string' ? formatDateTime(parsed.timestamp) : '';
    const level = typeof parsed.level === 'string' ? parsed.level : 'info';
    const event = typeof parsed.event === 'string' ? parsed.event : 'event';
    const details = Object.entries(parsed)
      .filter(([key]) => !['timestamp', 'level', 'event'].includes(key))
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return `${key}=${value}`;
        }
        return `${key}=${JSON.stringify(value)}`;
      })
      .join(' ');

    return `${timestamp} [${level}] ${event}${details ? ` | ${details}` : ''}`;
  } catch {
    return raw;
  }
}

function parseBackfillCoverageIncrement(lines: string[]): BackfillCoverageIncrement {
  let chunkGenerated = 0;
  let documentGenerated = 0;
  let directoryGenerated = 0;

  for (const raw of lines) {
    let entry: Record<string, unknown> | null = null;
    try {
      entry = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      entry = null;
    }
    if (!entry) {
      continue;
    }

    const event = entry.event;
    if (event === 'file_done') {
      const generatedChunks = entry.generatedChunks;
      if (typeof generatedChunks === 'number' && Number.isFinite(generatedChunks)) {
        chunkGenerated += Math.max(0, Math.floor(generatedChunks));
      }
      if (entry.documentSummaryUpdated === true) {
        documentGenerated += 1;
      }
      continue;
    }

    if (event === 'directory_summary_done' && entry.generated === true) {
      directoryGenerated += 1;
    }
  }

  return {
    chunkGenerated,
    documentGenerated,
    directoryGenerated,
  };
}

export function resolveProjectRunningMode(
  projectPath: string | null,
  indexingPath: string | null,
  currentMode: IndexingMode | null,
): IndexingMode | null {
  if (!projectPath || projectPath !== indexingPath) {
    return null;
  }
  return currentMode;
}

export function ProjectOverviewDialog({
  project,
  open,
  disabled = false,
  indexingPath,
  currentMode,
  progress,
  onOpenChange,
  onRunAction,
}: ProjectOverviewDialogProps) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logPath, setLogPath] = useState<string>('');
  const [logError, setLogError] = useState<string | null>(null);
  const [backfillCoverageBase, setBackfillCoverageBase] = useState<ProjectOverview['summaryCoverage'] | null>(null);
  const [liveBackfillIncrement, setLiveBackfillIncrement] = useState<BackfillCoverageIncrement>(
    EMPTY_BACKFILL_INCREMENT
  );
  const pollBusyRef = useRef(false);

  const loadOverview = useCallback(async (silent = false) => {
    if (!project) return;
    if (!silent) {
      setIsLoadingOverview(true);
    }
    setOverviewError(null);
    try {
      const result = await window.electronAPI.getProjectOverview(project.path);
      if (!result.success || !result.overview) {
        setOverviewError(result.error || '读取概况失败');
        setOverview(null);
        return;
      }
      setOverview(result.overview);
    } catch (error) {
      setOverviewError((error as Error).message);
      setOverview(null);
    } finally {
      if (!silent) {
        setIsLoadingOverview(false);
      }
    }
  }, [project]);

  const loadLogs = useCallback(async (mode: IndexingMode) => {
    if (!project) return;
    setLogError(null);
    try {
      const result = await window.electronAPI.getIndexingLog(project.path, mode);
      if (!result.success) {
        setLogError(result.error || '读取日志失败');
        return;
      }
      setLogPath(result.logPath || '');
      setLogLines(result.lines || []);
    } catch (error) {
      setLogError((error as Error).message);
    }
  }, [project]);

  const activeMode = resolveProjectRunningMode(project?.path ?? null, indexingPath, currentMode);
  const isCurrentProjectRunning = activeMode !== null;

  useEffect(() => {
    if (!open || !project) {
      return;
    }
    loadOverview();
    loadLogs(activeMode ?? 'incremental');
  }, [open, project, activeMode, loadOverview, loadLogs]);

  useEffect(() => {
    if (!open) {
      setBackfillCoverageBase(null);
      setLiveBackfillIncrement(EMPTY_BACKFILL_INCREMENT);
    }
  }, [open]);

  useEffect(() => {
    if (activeMode !== 'backfill-summary') {
      return;
    }

    const increment = parseBackfillCoverageIncrement(logLines);
    setLiveBackfillIncrement((prev) => ({
      chunkGenerated: Math.max(prev.chunkGenerated, increment.chunkGenerated),
      documentGenerated: Math.max(prev.documentGenerated, increment.documentGenerated),
      directoryGenerated: Math.max(prev.directoryGenerated, increment.directoryGenerated),
    }));
  }, [logLines, activeMode]);

  useEffect(() => {
    if (activeMode === 'backfill-summary' && !backfillCoverageBase && overview) {
      setBackfillCoverageBase(overview.summaryCoverage);
    }
  }, [activeMode, backfillCoverageBase, overview]);

  useEffect(() => {
    if (!open || !project || activeMode === null) {
      return;
    }

    const timer = window.setInterval(() => {
      if (pollBusyRef.current) {
        return;
      }
      pollBusyRef.current = true;

      void (async () => {
        if (activeMode === 'backfill-summary') {
          await loadLogs(activeMode);
          return;
        }
        await Promise.all([loadOverview(true), loadLogs(activeMode)]);
      })().finally(() => {
        pollBusyRef.current = false;
      });
    }, 1200);

    return () => {
      window.clearInterval(timer);
      pollBusyRef.current = false;
    };
  }, [open, project, activeMode, loadOverview, loadLogs]);

  const runAction = useCallback(
    async (mode: IndexingMode) => {
      if (!project) return;
      if (mode === 'reindex') {
        const confirmed = window.confirm('将删除该知识库现有索引并完整重建，确认继续吗？');
        if (!confirmed) {
          return;
        }
      }

      setActionError(null);
      setBackfillCoverageBase(null);
      setLiveBackfillIncrement(EMPTY_BACKFILL_INCREMENT);
      if (mode === 'backfill-summary' && overview) {
        setBackfillCoverageBase(overview.summaryCoverage);
      }
      try {
        await loadLogs(mode);
        const result = await onRunAction(project.path, mode);
        if (!result.success) {
          setActionError(result.error || '操作失败');
          return;
        }
        await loadOverview();
        await loadLogs(mode);
      } finally {
        setBackfillCoverageBase(null);
        setLiveBackfillIncrement(EMPTY_BACKFILL_INCREMENT);
      }
    },
    [project, overview, onRunAction, loadOverview, loadLogs]
  );

  const displaySummaryCoverage = useMemo(() => {
    if (!overview) {
      return null;
    }
    if (activeMode !== 'backfill-summary' || !backfillCoverageBase) {
      return overview.summaryCoverage;
    }

    const mergeCovered = (input: {
      total: number;
      currentCovered: number;
      baseCovered: number;
      generated: number;
    }) => {
      const estimated = Math.min(input.total, input.baseCovered + input.generated);
      const covered = Math.max(input.currentCovered, estimated);
      const ratio = input.total > 0 ? covered / input.total : 0;
      return {
        covered,
        total: input.total,
        ratio,
      };
    };

    return {
      chunk: mergeCovered({
        total: overview.summaryCoverage.chunk.total,
        currentCovered: overview.summaryCoverage.chunk.covered,
        baseCovered: backfillCoverageBase.chunk.covered,
        generated: liveBackfillIncrement.chunkGenerated,
      }),
      document: mergeCovered({
        total: overview.summaryCoverage.document.total,
        currentCovered: overview.summaryCoverage.document.covered,
        baseCovered: backfillCoverageBase.document.covered,
        generated: liveBackfillIncrement.documentGenerated,
      }),
      directory: mergeCovered({
        total: overview.summaryCoverage.directory.total,
        currentCovered: overview.summaryCoverage.directory.covered,
        baseCovered: backfillCoverageBase.directory.covered,
        generated: liveBackfillIncrement.directoryGenerated,
      }),
    };
  }, [overview, activeMode, backfillCoverageBase, liveBackfillIncrement]);

  const summaryRows = useMemo(() => {
    if (!displaySummaryCoverage) {
      return [];
    }
    return [
      { label: 'Chunk 摘要覆盖', stat: displaySummaryCoverage.chunk },
      { label: '文档摘要覆盖', stat: displaySummaryCoverage.document },
      { label: '目录摘要覆盖', stat: displaySummaryCoverage.directory },
    ];
  }, [displaySummaryCoverage]);

  const runningLabel = useMemo(() => {
    if (!activeMode) return '';
    if (activeMode === 'incremental') return '增量更新';
    if (activeMode === 'backfill-summary') return '补全 Summary';
    return '重新索引';
  }, [activeMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={PROJECT_OVERVIEW_DIALOG_CONTENT_CLASSNAME}>
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6">
          <DialogTitle>知识库设置</DialogTitle>
          <DialogDescription>
            {project ? `项目：${project.alias}` : '查看知识库概况并执行维护操作'}
          </DialogDescription>
        </DialogHeader>

        {isLoadingOverview ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : overview ? (
          <div className={PROJECT_OVERVIEW_DIALOG_BODY_CLASSNAME}>
            <div className="space-y-4">
              {isCurrentProjectRunning && progress && (
                <div className="rounded-md border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">执行进度</p>
                  <IndexProgressBar progress={progress} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">文件数量</p>
                  <p className="text-sm font-medium">{overview.fileCount}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">已索引文件数量</p>
                  <p className="text-sm font-medium">{overview.indexedFileCount}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Chunk 数量</p>
                  <p className="text-sm font-medium">{overview.chunkCount}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">最近更新时间</p>
                  <p className="text-sm font-medium">{formatDateTime(overview.lastUpdated)}</p>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">索引程序版本</p>
                  <Badge variant="secondary">{overview.indexerVersion}</Badge>
                </div>
                <Separator className="my-3" />
                <div className="space-y-2">
                  {summaryRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between text-sm">
                      <span>{row.label}</span>
                      <span className="text-muted-foreground">
                        {row.stat.covered}/{row.stat.total} ({formatPercent(row.stat.ratio)})
                      </span>
                    </div>
                  ))}
                </div>
                {activeMode === 'backfill-summary' && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    执行中显示实时增量，最终以任务完成后的统计为准
                  </p>
                )}
              </div>

              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">执行日志</p>
                  <span className="text-[11px] text-muted-foreground">
                    {logPath ? logPath.split('/').pop() : ''}
                  </span>
                </div>
                <ScrollArea className="mt-2 h-44 rounded-md border bg-muted/30 p-2">
                  {logLines.length > 0 ? (
                    <pre className="whitespace-pre-wrap break-all text-[11px] leading-5 text-foreground">
                      {logLines.map(formatLogLine).join('\n')}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无日志</p>
                  )}
                </ScrollArea>
                {logError && (
                  <p className="mt-2 text-xs text-destructive">{logError}</p>
                )}
              </div>

              {(actionError || overviewError) && (
                <p className="text-sm text-destructive">{actionError || overviewError}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 px-6 py-4">
            <p className="text-sm text-destructive">{overviewError || '暂无概况数据'}</p>
          </div>
        )}

        <DialogFooter className="flex shrink-0 gap-2 border-t px-6 py-4 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {activeMode ? `正在执行：${runningLabel}...` : ''}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={disabled || activeMode !== null}
              onClick={() => runAction('incremental')}
            >
              增量更新
            </Button>
            <Button
              variant="outline"
              disabled={disabled || activeMode !== null}
              onClick={() => runAction('backfill-summary')}
            >
              补全Summary
            </Button>
            <Button
              variant="destructive"
              disabled={disabled || activeMode !== null}
              onClick={() => runAction('reindex')}
            >
              重新索引
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
