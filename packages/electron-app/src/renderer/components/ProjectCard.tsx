import React from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip';
import { IndexProgress as IndexProgressBar } from './IndexProgress';
import { ProjectSummaryEditor } from './ProjectSummaryEditor';
import { formatRelativeTime } from '../lib/utils';

interface ProjectCardProps {
  project: RegisteredProject;
  isUpdating: boolean;
  progress: IndexProgress | null;
  onUpdate: () => void;
  onRemove: () => void;
  onSummaryChange: (summary: string) => void;
}

export function ProjectCard({
  project,
  isUpdating,
  progress,
  onUpdate,
  onRemove,
  onSummaryChange,
}: ProjectCardProps) {
  return (
    <Card className="min-w-0 w-full max-w-full p-3 pr-3 space-y-2 hover:bg-accent/50 cursor-default transition-colors duration-150">
      {/* Header: title + action buttons */}
      <div className="relative min-w-0 pr-14">
        <span className="block min-w-0 font-medium text-sm leading-tight truncate">
          {project.alias}
        </span>
        <div className="absolute right-1 top-0 z-10 flex items-center shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 cursor-pointer"
            disabled={isUpdating}
            onClick={onUpdate}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive cursor-pointer"
            disabled={isUpdating}
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Path */}
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="min-w-0 text-xs text-muted-foreground truncate">
            {project.path}
          </p>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <p className="text-xs">{project.path}</p>
        </TooltipContent>
      </Tooltip>

      {/* Stats + time */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Badge variant="secondary" className="min-w-0 max-w-[160px] truncate text-[10px] px-1.5 py-0">
          {project.totalFileCount} 文件 · {project.totalChunkCount} chunks
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(project.lastUpdated)}
        </span>
      </div>

      {/* Summary */}
      <ProjectSummaryEditor
        summary={project.summary}
        onSave={onSummaryChange}
      />

      {/* Index progress */}
      {isUpdating && progress && (
        <IndexProgressBar progress={progress} />
      )}
    </Card>
  );
}
