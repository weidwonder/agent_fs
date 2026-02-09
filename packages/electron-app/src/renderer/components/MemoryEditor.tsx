import React, { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Pencil, Save } from 'lucide-react';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { Textarea } from './ui/textarea';
import { useMemory } from '../hooks/useMemory';

interface MemoryEditorProps {
  projectId: string;
}

export function MemoryEditor({ projectId }: MemoryEditorProps) {
  const { exists, projectMd, files, loading, save } = useMemory(projectId);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState('');

  const extraFiles = files.filter((file) => file.path !== 'project.md');

  const handleStartEdit = useCallback(() => {
    setDraft(projectMd);
    setEditing(true);
    setExpanded(true);
  }, [projectMd]);

  const handleCancel = useCallback(() => {
    setDraft(projectMd);
    setEditing(false);
  }, [projectMd]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const result = await save('project.md', draft);
    setSaving(false);
    if (result.success) {
      setEditing(false);
    }
  }, [draft, save]);

  return (
    <div className="space-y-1">
      <button
        className="flex w-full items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <FileText className="h-3 w-3" />
        <span>项目记忆{exists ? `（${files.length} 文件）` : '（未创建）'}</span>
      </button>

      {expanded && (
        <div className="space-y-2 pl-4">
          {loading ? (
            <p className="text-xs text-muted-foreground">加载中...</p>
          ) : editing ? (
            <div className="space-y-2">
              <Textarea
                className="min-h-[120px] text-xs"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 cursor-pointer"
                  disabled={saving}
                  onClick={handleSave}
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  <span className="text-xs">{saving ? '保存中...' : '保存'}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 cursor-pointer"
                  disabled={saving}
                  onClick={handleCancel}
                >
                  <span className="text-xs">取消</span>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words line-clamp-4">
                {projectMd || '暂无项目记忆'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 cursor-pointer"
                onClick={handleStartEdit}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">{exists ? '编辑' : '创建'}</span>
              </Button>
            </div>
          )}

          {extraFiles.length > 0 && (
            <>
              <Separator />
              <div className="space-y-0.5">
                {extraFiles.map((file) => (
                  <p key={file.path} className="truncate text-xs text-muted-foreground">
                    📄 {file.path}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
