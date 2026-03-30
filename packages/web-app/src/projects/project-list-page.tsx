import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

interface Project {
  id: string;
  name: string;
  created_at: string;
}

interface ProjectsResponse {
  projects: Project[];
}

export function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<ProjectsResponse>('/projects')
      .then((d) => setProjects(d.projects))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const result = await api<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() }),
      });
      setProjects((prev) => [result, ...prev]);
      setNewName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-gray-400">Loading projects...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Knowledge Base Projects</h1>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded px-3 py-2">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={createProject} className="flex gap-2 mb-8">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </form>

      {projects.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No projects yet</p>
          <p className="text-sm mt-1">Create your first knowledge base project above</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="block p-5 bg-white rounded-lg shadow border border-gray-100 hover:shadow-md hover:border-blue-200 transition-all"
            >
              <h2 className="font-semibold text-gray-900">{p.name}</h2>
              <p className="text-xs text-gray-400 mt-2">
                Created {new Date(p.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
