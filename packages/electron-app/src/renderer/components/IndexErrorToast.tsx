import React from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';

interface IndexErrorToastProps {
  error: string | null;
  onClose: () => void;
}

export function IndexErrorToast({ error, onClose }: IndexErrorToastProps) {
  if (!error) {
    return null;
  }

  return (
    <div className="fixed bottom-12 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg bg-destructive p-3 pr-2 text-sm text-destructive-foreground shadow-lg animate-in slide-in-from-bottom-2">
      <p className="min-w-0 flex-1 break-words">索引失败：{error}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground"
        onClick={onClose}
        aria-label="关闭索引错误提示"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
