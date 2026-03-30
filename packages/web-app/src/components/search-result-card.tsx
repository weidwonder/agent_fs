interface SearchResult {
  chunkId?: string;
  chunk_id?: string;
  score?: number;
  content?: string;
  // Backend returns flat fields from SearchResult type
  filePath?: string;
  locator?: string;
  // Legacy nested shape — kept for backward compatibility
  document?: {
    file_path?: string;
    locator?: string;
  };
}

interface SearchResultCardProps {
  result: SearchResult;
  index: number;
}

export function SearchResultCard({ result, index }: SearchResultCardProps) {
  const chunkId = result.chunkId ?? result.chunk_id ?? '';
  const filePath = result.filePath ?? result.document?.file_path ?? '';
  const content = result.content ?? '';

  return (
    <div className="bg-white p-4 rounded-lg shadow border border-gray-100 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-xs font-medium text-white bg-blue-500 rounded-full w-5 h-5 flex items-center justify-center">
            {index + 1}
          </span>
          {filePath && (
            <span className="text-xs text-gray-500 truncate" title={filePath}>
              {filePath.split('/').pop()}
            </span>
          )}
          {chunkId && !filePath && (
            <span className="text-xs font-mono text-blue-600 truncate" title={chunkId}>
              {chunkId}
            </span>
          )}
        </div>
        {result.score !== undefined && (
          <span className="shrink-0 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
            {result.score.toFixed(4)}
          </span>
        )}
      </div>
      {content && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-6">
          {content}
        </p>
      )}
    </div>
  );
}
