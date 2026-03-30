import { useState } from 'react';
import { api } from '../api/client.js';
import { SearchResultCard } from '../components/search-result-card.js';

interface SearchResult {
  chunkId?: string;
  chunk_id?: string;
  score?: number;
  content?: string;
  document?: {
    file_path?: string;
    locator?: string;
  };
}

interface SearchResponse {
  results: SearchResult[];
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const data = await api<SearchResponse>('/search', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(),
          keyword: keyword.trim() || undefined,
          topK: 10,
        }),
      });
      setResults(data.results);
      setSearched(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Search Knowledge Base</h1>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Semantic query..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Keyword filter (optional)"
          className="w-52 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded px-3 py-2">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {searching && (
        <div className="text-center py-8 text-gray-400">Searching...</div>
      )}

      {!searching && searched && results.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p>No results found for "{query}"</p>
        </div>
      )}

      {!searching && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{results.length} result(s)</p>
          {results.map((r, i) => (
            <SearchResultCard key={i} result={r} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
