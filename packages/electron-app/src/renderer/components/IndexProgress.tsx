import React from 'react';
import { PHASE_NAMES } from '../hooks/useIndexing';

interface IndexProgressProps {
  progress: IndexProgress;
}

export function IndexProgress({ progress }: IndexProgressProps) {
  const { phase, currentFile, processed, total } = progress;
  const phaseName = PHASE_NAMES[phase] || phase;
  const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

  // Extract file name from full path
  const fileName = currentFile.split('/').pop() || currentFile;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate mr-2">
          {phaseName}
          {fileName ? ` - ${fileName}` : ''}
        </span>
        <span className="shrink-0 tabular-nums">
          {processed} / {total}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
