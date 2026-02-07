import React, { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

interface ProjectSummaryEditorProps {
  summary: string;
  onSave: (newSummary: string) => void;
}

type ViewState = 'collapsed' | 'expanded' | 'editing';

export function ProjectSummaryEditor({ summary, onSave }: ProjectSummaryEditorProps) {
  const [state, setState] = useState<ViewState>('collapsed');
  const [draft, setDraft] = useState(summary);

  const handleStartEdit = () => {
    setDraft(summary);
    setState('editing');
  };

  const handleSave = () => {
    onSave(draft);
    setState('collapsed');
  };

  const handleCancel = () => {
    setDraft(summary);
    setState('collapsed');
  };

  if (state === 'editing') {
    return (
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-[60px] text-xs resize-none"
          autoFocus
        />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 cursor-pointer"
            onClick={handleSave}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            <span className="text-xs">保存</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 cursor-pointer"
            onClick={handleCancel}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            <span className="text-xs">取消</span>
          </Button>
        </div>
      </div>
    );
  }

  if (state === 'expanded') {
    return (
      <div className="space-y-1.5">
        <p
          className="text-xs text-muted-foreground cursor-pointer"
          onClick={() => setState('collapsed')}
        >
          {summary || '暂无描述'}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 cursor-pointer"
          onClick={handleStartEdit}
        >
          <Pencil className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">编辑</span>
        </Button>
      </div>
    );
  }

  // collapsed (default)
  return (
    <p
      className="text-xs text-muted-foreground line-clamp-2 cursor-pointer"
      onClick={() => setState('expanded')}
    >
      {summary || '暂无描述'}
    </p>
  );
}
