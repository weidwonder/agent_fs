import React, { useCallback, useMemo } from 'react';
import { FileText } from 'lucide-react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip';
import { cn } from '../lib/utils';

interface SearchResultCardProps {
  result: SearchResultItem;
  query: string;
  keyword?: string;
}

function highlightText(text: string, query: string, keyword?: string) {
  const words: string[] = [];

  if (query) {
    words.push(...query.split(/\s+/).filter(Boolean));
  }
  if (keyword) {
    words.push(...keyword.split(/\s+/).filter(Boolean));
  }

  if (words.length === 0) {
    return <>{text}</>;
  }

  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-yellow-200 text-foreground rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function getScoreBadgeClass(score: number): string {
  if (score >= 0.04) return 'bg-emerald-100 text-emerald-800';
  if (score >= 0.02) return 'bg-amber-100 text-amber-800';
  return 'bg-stone-100 text-stone-600';
}

export function SearchResultCard({
  result,
  query,
  keyword,
}: SearchResultCardProps) {
  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(result.source.file_path);
  }, [result.source.file_path]);

  const highlightedContent = useMemo(() => {
    if (!result.content) return null;
    return highlightText(result.content, query, keyword);
  }, [result.content, query, keyword]);

  return (
    <Card className="p-4 space-y-2 hover:shadow-md transition-shadow duration-150">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              'border-transparent',
              getScoreBadgeClass(result.score),
            )}
          >
            {result.score.toFixed(4)}
          </Badge>
          {typeof result.chunk_hits === 'number' && result.chunk_hits > 1 && (
            <Badge variant="secondary" className="text-xs">
              命中 {result.chunk_hits} chunks
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate max-w-[120px]">
          {result.chunk_id}
        </span>
      </div>

      {/* Summary */}
      {result.summary && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            摘要
          </p>
          <p className="text-sm text-foreground line-clamp-3 break-words">
            {result.summary}
          </p>
        </div>
      )}

      {/* Content */}
      {result.content && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            正文
          </p>
          <div className="relative max-h-[160px] overflow-hidden">
            <p className="text-sm break-words">{highlightedContent}</p>
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent pointer-events-none" />
          </div>
        </div>
      )}

      {/* Source */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex items-center gap-2 border-t pt-2 mt-2 cursor-pointer group"
            onClick={handleCopyPath}
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              {result.source.file_path}
            </span>
            {result.source.locator && (
              <>
                <span className="text-xs text-muted-foreground shrink-0">
                  ·
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {result.source.locator}
                </span>
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <p className="text-xs">点击复制路径</p>
        </TooltipContent>
      </Tooltip>
    </Card>
  );
}
