import React, { useEffect } from 'react';
import { Search, Loader2, SearchX } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { SearchScopeSelector } from './SearchScopeSelector';
import { SearchResultCard } from './SearchResultCard';
import { useSearch } from '../hooks/useSearch';

interface SearchPanelProps {
  projects: RegisteredProject[];
  onSearchComplete?: (meta: SearchMeta | null) => void;
}

export function SearchPanel({ projects, onSearchComplete }: SearchPanelProps) {
  const {
    query,
    setQuery,
    keyword,
    setKeyword,
    selectedScopes,
    initScopes,
    toggleScope,
    selectAll,
    deselectAll,
    results,
    meta,
    isSearching,
    error,
    search,
  } = useSearch();

  useEffect(() => {
    initScopes(projects.map((p) => p.path));
  }, [projects, initScopes]);

  useEffect(() => {
    onSearchComplete?.(meta);
  }, [meta, onSearchComplete]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      search();
    }
  };

  return (
    <div className="flex flex-col h-full p-4">
      {/* Search area - sticky */}
      <div className="sticky top-0 bg-background z-10 pb-4 space-y-2">
        {/* Main query row */}
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            placeholder="语义搜索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            size="icon"
            className="cursor-pointer shrink-0"
            disabled={isSearching || !query.trim() || selectedScopes.length === 0}
            onClick={() => search()}
          >
            {isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Keyword row */}
        <Input
          className="text-sm h-8"
          placeholder="精确关键词（可选）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {/* Scope selector */}
        <SearchScopeSelector
          projects={projects}
          selectedScopes={selectedScopes}
          onToggle={toggleScope}
          onSelectAll={() => selectAll(projects.map((p) => p.path))}
          onDeselectAll={deselectAll}
        />
      </div>

      {/* Search meta info */}
      {results && meta && (
        <p className="text-xs text-muted-foreground mb-3">
          {results.length} 条结果 · {meta.elapsed_ms}ms · {meta.fusion_method}
        </p>
      )}

      {/* Results area */}
      <ScrollArea className="flex-1">
        {/* Loading state */}
        {isSearching && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-lg border bg-card p-4 space-y-3 animate-pulse"
              >
                <div className="flex justify-between items-center">
                  <div className="h-5 w-16 bg-muted rounded-full" />
                  <div className="h-4 w-24 bg-muted rounded" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-12 bg-muted rounded" />
                  <div className="h-4 w-full bg-muted rounded" />
                  <div className="h-4 w-3/4 bg-muted rounded" />
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="h-3 w-48 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {!isSearching && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Empty state */}
        {!isSearching && !error && results !== null && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <SearchX className="h-10 w-10 mb-3" />
            <p className="text-sm">未找到匹配结果，试试其他关键词</p>
          </div>
        )}

        {/* Initial state */}
        {!isSearching && !error && results === null && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Search className="h-10 w-10 mb-3" />
            <p className="text-sm">输入查询开始搜索</p>
          </div>
        )}

        {/* Results list */}
        {!isSearching && results && results.length > 0 && (
          <div className="space-y-3">
            {results.map((item) => (
              <SearchResultCard
                key={item.chunk_id}
                result={item}
                query={query}
                keyword={keyword}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
