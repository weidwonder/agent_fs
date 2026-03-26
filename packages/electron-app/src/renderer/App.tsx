import React, { useState, useCallback, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { TooltipProvider } from './components/ui/tooltip';
import { Button } from './components/ui/button';
import { Separator } from './components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './components/ui/alert-dialog';
import { Sidebar } from './components/Sidebar';
import { SearchPanel } from './components/SearchPanel';
import { StatusBar } from './components/StatusBar';
import { SettingsDialog } from './components/SettingsDialog';
import { ProjectOverviewDialog } from './components/ProjectOverviewDialog';
import { useRegistry } from './hooks/useRegistry';
import { useIndexing } from './hooks/useIndexing';

export default function App() {
  const { projects, refresh } = useRegistry();
  const { indexingPath, progress, error: indexError, startIndexing, selectAndIndex } = useIndexing(refresh);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ projectId: string; alias: string; path: string } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [removeStatusMessage, setRemoveStatusMessage] = useState<{
    type: 'info' | 'error';
    text: string;
  } | null>(null);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [overviewProject, setOverviewProject] = useState<RegisteredProject | null>(null);

  // 移除项目
  const handleRemoveConfirm = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!removeTarget || removePending) return;
    setRemoveError(null);
    setRemovePending(true);
    try {
      const result = await window.electronAPI.removeProject(removeTarget.projectId);
      if (result.success) {
        setRemoveTarget(null);
        await refresh();
        if (result.cleanup_started) {
          setRemoveStatusMessage({
            type: 'info',
            text: '项目入口已移除，正在后台清理索引数据…',
          });
        }
      } else {
        setRemoveError(result.error || '移除失败');
      }
    } finally {
      setRemovePending(false);
    }
  }, [removeTarget, removePending, refresh]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onProjectRemovalStatus((status) => {
      if (status.phase === 'completed') {
        setRemoveStatusMessage({
          type: 'info',
          text: '项目索引数据清理完成。',
        });
        return;
      }

      if (status.phase === 'failed') {
        setRemoveStatusMessage({
          type: 'error',
          text: `后台清理失败：${status.error || '未知错误'}`,
        });
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!removeStatusMessage) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setRemoveStatusMessage(null);
    }, 5000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [removeStatusMessage]);

  // 更新项目描述
  const handleSummaryChange = useCallback(async (projectId: string, summary: string) => {
    await window.electronAPI.updateProjectSummary(projectId, summary);
    refresh();
  }, [refresh]);

  const handleRunProjectAction = useCallback(async (
    dirPath: string,
    mode: IndexingMode
  ) => {
    return startIndexing(dirPath, { mode });
  }, [startIndexing]);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 h-12 border-b bg-background shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="flex items-center gap-2 pl-16">
            <h1 className="text-sm font-semibold text-foreground tracking-tight">Agent FS</h1>
            <span className="text-xs text-muted-foreground">文档智能索引</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="cursor-pointer"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 min-w-0 overflow-hidden">
          {/* Sidebar */}
          <Sidebar
            projects={projects}
            indexingPath={indexingPath}
            progress={progress}
            onAddDirectory={selectAndIndex}
            onUpdateProject={(path) => startIndexing(path, { mode: 'incremental' })}
            onManageProject={(projectId) => {
              const project = projects.find((p) => p.projectId === projectId);
              if (project) {
                setOverviewProject(project);
              }
            }}
            onRemoveProject={(projectId) => {
              const project = projects.find((p) => p.projectId === projectId);
              if (project) {
                setRemoveTarget({ projectId, alias: project.alias || project.path, path: project.path });
              }
            }}
            onSummaryChange={handleSummaryChange}
          />

          <Separator orientation="vertical" className="relative z-20 shrink-0" />

          {/* Search Panel */}
          <main className="relative z-0 flex-1 min-w-0 flex flex-col overflow-hidden">
            <SearchPanel projects={projects} onSearchComplete={setSearchMeta} />
          </main>
        </div>

        {/* Status Bar */}
        <StatusBar
          projects={projects}
          indexingPath={indexingPath}
          progress={progress}
          searchMeta={searchMeta}
        />

        {/* Settings Dialog */}
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

        <ProjectOverviewDialog
          project={overviewProject}
          open={overviewProject !== null}
          disabled={indexingPath !== null}
          indexingPath={indexingPath}
          progress={progress}
          onOpenChange={(open) => {
            if (!open) {
              setOverviewProject(null);
            }
          }}
          onRunAction={handleRunProjectAction}
        />

        {/* Remove Confirmation Dialog */}
        <AlertDialog
          open={removeTarget !== null}
          onOpenChange={(open) => {
            if (removePending) return;
            if (!open) setRemoveTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定移除项目？</AlertDialogTitle>
              <AlertDialogDescription>
                将移除项目「{removeTarget?.alias}」并删除 {removeTarget?.path}/.fs_index 下的所有索引数据。此操作不可恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            {removeError && (
              <p className="text-sm text-destructive">{removeError}</p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel className="cursor-pointer" disabled={removePending}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
                disabled={removePending}
                onClick={handleRemoveConfirm}
              >
                {removePending ? '正在移除...' : '确定移除'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Index Error Toast */}
        {indexError && (
          <div className="fixed bottom-12 right-4 max-w-sm p-3 rounded-lg bg-destructive text-destructive-foreground text-sm shadow-lg animate-in slide-in-from-bottom-2">
            索引失败：{indexError}
          </div>
        )}

        {removeStatusMessage && (
          <div className={`fixed bottom-12 left-4 max-w-sm p-3 rounded-lg text-sm shadow-lg animate-in slide-in-from-bottom-2 ${
            removeStatusMessage.type === 'error'
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-primary text-primary-foreground'
          }`}>
            {removeStatusMessage.text}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
