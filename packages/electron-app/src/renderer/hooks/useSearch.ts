import { useState, useCallback } from 'react';

export function useSearch() {
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initScopes = useCallback((projectPaths: string[]) => {
    setSelectedScopes(projectPaths);
  }, []);

  const toggleScope = useCallback((path: string) => {
    setSelectedScopes((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }, []);

  const selectAll = useCallback((allPaths: string[]) => {
    setSelectedScopes(allPaths);
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedScopes([]);
  }, []);

  const search = useCallback(async () => {
    if (!query.trim() || selectedScopes.length === 0) return;

    setIsSearching(true);
    setError(null);
    try {
      const response = await window.electronAPI.search({
        query: query.trim(),
        keyword: keyword.trim() || undefined,
        scope: selectedScopes,
        top_k: 10,
      });
      setResults(response.results);
      setMeta(response.meta);
    } catch (e) {
      setError((e as Error).message);
      setResults(null);
      setMeta(null);
    } finally {
      setIsSearching(false);
    }
  }, [query, keyword, selectedScopes]);

  return {
    query, setQuery,
    keyword, setKeyword,
    selectedScopes,
    initScopes, toggleScope, selectAll, deselectAll,
    results, meta,
    isSearching, error,
    search,
  };
}
