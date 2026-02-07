import React from 'react';
import { Plus, FolderOpen } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { TooltipProvider } from './ui/tooltip';
import { ProjectCard } from './ProjectCard';

interface SidebarProps {
  projects: RegisteredProject[];
  indexingPath: string | null;
  progress: IndexProgress | null;
  onAddDirectory: () => void;
  onUpdateProject: (path: string) => void;
  onRemoveProject: (projectId: string) => void;
  onSummaryChange: (projectId: string, summary: string) => void;
}

export function Sidebar({
  projects,
  indexingPath,
  progress,
  onAddDirectory,
  onUpdateProject,
  onRemoveProject,
  onSummaryChange,
}: SidebarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="w-[280px] min-w-[280px] max-w-[280px] shrink-0 h-full flex flex-col overflow-hidden bg-sidebar border-r border-sidebar-border">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium">项目</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {projects.length}
          </Badge>
        </div>

        <Separator />

        {/* Project list */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {projects.length > 0 ? (
              projects.map((project) => (
                <ProjectCard
                  key={project.projectId}
                  project={project}
                  isUpdating={indexingPath === project.path}
                  progress={indexingPath === project.path ? progress : null}
                  onUpdate={() => onUpdateProject(project.path)}
                  onRemove={() => onRemoveProject(project.projectId)}
                  onSummaryChange={(summary) =>
                    onSummaryChange(project.projectId, summary)
                  }
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FolderOpen className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm">暂无项目</p>
                <p className="text-xs mt-1">点击下方按钮添加目录</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        {/* Footer: add directory button */}
        <div className="p-3">
          <Button
            variant="outline"
            className="w-full cursor-pointer"
            onClick={onAddDirectory}
          >
            <Plus className="h-4 w-4 mr-2" />
            添加目录
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
