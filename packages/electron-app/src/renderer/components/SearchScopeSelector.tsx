import React from 'react';
import { Badge } from './ui/badge';

interface SearchScopeSelectorProps {
  projects: RegisteredProject[];
  selectedScopes: string[];
  onToggle: (path: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export function SearchScopeSelector({
  projects,
  selectedScopes,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: SearchScopeSelectorProps) {
  if (projects.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-wrap gap-1.5 flex-1">
        {projects.map((project) => {
          const selected = selectedScopes.includes(project.path);
          return (
            <Badge
              key={project.path}
              variant={selected ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => onToggle(project.path)}
            >
              {project.alias}
            </Badge>
          );
        })}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          onClick={onSelectAll}
        >
          全选
        </button>
        <span className="text-xs text-muted-foreground">/</span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          onClick={onDeselectAll}
        >
          取消
        </button>
      </div>
    </div>
  );
}
