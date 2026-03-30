import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, uploadFiles, createEventSource } from '../api/client.js';
import { FileUpload } from '../components/file-upload.js';

interface ProjectFile {
  id: string;
  name: string;
  size_bytes: number;
  chunk_count: number;
  status: 'pending' | 'indexing' | 'indexed' | 'failed';
  indexed_at: string | null;
}

interface FilesResponse {
  files: ProjectFile[];
}

interface IndexingEventFile {
  id: string;
  name: string;
  status: string;
  chunk_count: number;
  error_message: string | null;
  indexed_at: string | null;
}

interface IndexingEvent {
  files: IndexingEventFile[];
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-700' },
  indexing: { label: 'Indexing', className: 'bg-blue-100 text-blue-700' },
  indexed: { label: 'Indexed', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const eventSourceRef = useRef<EventSource | null>(null);

  const loadFiles = async () => {
    if (!id) return;
    try {
      const data = await api<FilesResponse>(`/projects/${id}/files`);
      setFiles(data.files);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    }
  };

  useEffect(() => {
    setLoading(true);
    loadFiles().finally(() => setLoading(false));

    if (id) {
      void createEventSource(`/projects/${id}/indexing-events`).then((es) => {
        eventSourceRef.current = es;
        es.onmessage = (e) => {
          try {
            const event = JSON.parse(e.data as string) as IndexingEvent;
            if (!Array.isArray(event.files)) return;
            const updatedMap = new Map(event.files.map((f) => [f.id, f]));
            setFiles((prev) =>
              prev.map((f) => {
                const updated = updatedMap.get(f.id);
                if (!updated) return f;
                return {
                  ...f,
                  status: updated.status as ProjectFile['status'],
                  chunk_count: updated.chunk_count ?? f.chunk_count,
                  indexed_at: updated.indexed_at ?? f.indexed_at,
                };
              }),
            );
          } catch {
            // ignore parse errors
          }
        };
      });
    }

    return () => {
      eventSourceRef.current?.close();
    };
  }, [id]);

  const handleUpload = async (uploadedFiles: File[]) => {
    if (!id) return;
    await uploadFiles(id, uploadedFiles);
    await loadFiles();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">
          Projects
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">Files</h1>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded px-3 py-2">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      <div className="mb-6">
        <FileUpload onUpload={handleUpload} />
      </div>

      {files.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-white rounded-lg border border-dashed border-gray-200">
          <p>No files yet. Upload documents to start indexing.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-3 font-medium text-gray-500">File Name</th>
                <th className="text-left p-3 font-medium text-gray-500">Size</th>
                <th className="text-left p-3 font-medium text-gray-500">Chunks</th>
                <th className="text-left p-3 font-medium text-gray-500">Status</th>
                <th className="text-left p-3 font-medium text-gray-500">Indexed At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {files.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-900">{f.name}</td>
                  <td className="p-3 text-gray-500">
                    {(f.size_bytes / 1024).toFixed(1)} KB
                  </td>
                  <td className="p-3 text-gray-600">{f.chunk_count ?? '-'}</td>
                  <td className="p-3">
                    <StatusBadge status={f.status} />
                  </td>
                  <td className="p-3 text-gray-400">
                    {f.indexed_at ? new Date(f.indexed_at).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
