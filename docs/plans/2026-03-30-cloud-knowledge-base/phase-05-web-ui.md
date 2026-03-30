# Phase 5: Web UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `packages/web-app` — a React SPA for cloud users to manage projects, upload documents, and search knowledge bases.

**Prerequisite:** Phase 4 (server API) complete.

**Spec:** `docs/specs/2026-03-30-cloud-knowledge-base-design.md` §8

---

## File Map

```
packages/web-app/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
│   ├── main.tsx                    # React entry
│   ├── app.tsx                     # Router + layout
│   ├── api/
│   │   └── client.ts              # Fetch wrapper with JWT
│   ├── auth/
│   │   ├── auth-context.tsx        # Auth state (JWT, user)
│   │   ├── login-page.tsx
│   │   └── register-page.tsx
│   ├── projects/
│   │   ├── project-list-page.tsx   # List + create projects
│   │   └── project-detail-page.tsx # Files, upload, indexing status
│   ├── search/
│   │   └── search-page.tsx         # Semantic + keyword search
│   ├── settings/
│   │   └── settings-page.tsx       # LLM/Embedding config, members
│   └── components/
│       ├── layout.tsx              # Sidebar + main content
│       ├── file-upload.tsx         # Drag-and-drop uploader
│       └── search-result-card.tsx  # Search result display
```

---

### Task 1: Scaffold `packages/web-app`

**Files:**
- Create: `packages/web-app/package.json`
- Create: `packages/web-app/vite.config.ts`
- Create: `packages/web-app/tsconfig.json`
- Create: `packages/web-app/index.html`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agent-fs/web-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  build: { outDir: 'dist' },
});
```

- [ ] **Step 3: Create index.html + tsconfig.json**

```html
<!-- packages/web-app/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent FS — Knowledge Base</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Install + commit**

```bash
pnpm install
git add packages/web-app/
git commit -m "chore: scaffold @agent-fs/web-app with Vite + React + TailwindCSS"
```

---

### Task 2: API Client + Auth Context

**Files:**
- Create: `packages/web-app/src/api/client.ts`
- Create: `packages/web-app/src/auth/auth-context.tsx`

- [ ] **Step 1: Write API client**

```typescript
// packages/web-app/src/api/client.ts

const BASE_URL = '/api';

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && refreshToken) {
    // Try refresh
    const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (refreshResponse.ok) {
      const data = await refreshResponse.json();
      setTokens(data.accessToken, refreshToken!);
      headers['Authorization'] = `Bearer ${data.accessToken}`;
      const retryResponse = await fetch(`${BASE_URL}${path}`, { ...options, headers });
      if (!retryResponse.ok) throw new Error(`API error: ${retryResponse.status}`);
      return retryResponse.json();
    }
    clearTokens();
    window.location.href = '/login';
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json();
}

export async function uploadFiles(projectId: string, files: File[]): Promise<any> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('file', file);
  }

  const response = await fetch(`${BASE_URL}/projects/${projectId}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  return response.json();
}
```

- [ ] **Step 2: Write auth context**

```tsx
// packages/web-app/src/auth/auth-context.tsx

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, setTokens, clearTokens } from '../api/client';

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  tenantId: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, tenantName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserId(payload.userId);
        setTenantId(payload.tenantId);
      } catch {
        clearTokens();
      }
    }
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setTokens(data.accessToken, data.refreshToken);
    setUserId(data.userId);
    setTenantId(data.tenantId);
  };

  const register = async (email: string, password: string, tenantName: string) => {
    const data = await api<any>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, tenantName }),
    });
    setTokens(data.accessToken, data.refreshToken);
    setUserId(data.userId);
    setTenantId(data.tenantId);
  };

  const logout = () => {
    clearTokens();
    setUserId(null);
    setTenantId(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!userId, userId, tenantId, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 3: Commit**

```bash
git add packages/web-app/src/api/ packages/web-app/src/auth/auth-context.tsx
git commit -m "feat(web-app): add API client with JWT refresh and auth context"
```

---

### Task 3: Login / Register Pages

**Files:**
- Create: `packages/web-app/src/auth/login-page.tsx`
- Create: `packages/web-app/src/auth/register-page.tsx`

- [ ] **Step 1: Write login page**

```tsx
// packages/web-app/src/auth/login-page.tsx

import { useState } from 'react';
import { useAuth } from './auth-context';
import { useNavigate, Link } from 'react-router-dom';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-96 space-y-4">
        <h1 className="text-2xl font-bold text-center">Agent FS</h1>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full px-3 py-2 border rounded-md" required />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded-md" required />
        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">
          登录
        </button>
        <p className="text-center text-sm text-gray-500">
          没有账号？ <Link to="/register" className="text-blue-600">注册</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write register page (similar to login with extra tenantName field)**

```tsx
// packages/web-app/src/auth/register-page.tsx

import { useState } from 'react';
import { useAuth } from './auth-context';
import { useNavigate, Link } from 'react-router-dom';

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await register(email, password, tenantName);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-96 space-y-4">
        <h1 className="text-2xl font-bold text-center">创建账号</h1>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <input type="text" placeholder="团队名称" value={tenantName} onChange={e => setTenantName(e.target.value)}
          className="w-full px-3 py-2 border rounded-md" required />
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full px-3 py-2 border rounded-md" required />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded-md" required />
        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">
          注册
        </button>
        <p className="text-center text-sm text-gray-500">
          已有账号？ <Link to="/login" className="text-blue-600">登录</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web-app/src/auth/
git commit -m "feat(web-app): add login and register pages"
```

---

### Task 4: Router + Layout + Project Pages

**Files:**
- Create: `packages/web-app/src/main.tsx`
- Create: `packages/web-app/src/app.tsx`
- Create: `packages/web-app/src/components/layout.tsx`
- Create: `packages/web-app/src/projects/project-list-page.tsx`
- Create: `packages/web-app/src/projects/project-detail-page.tsx`

- [ ] **Step 1: Write main.tsx**

```tsx
// packages/web-app/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/auth-context';
import { App } from './app';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 2: Write app.tsx with routes**

```tsx
// packages/web-app/src/app.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/auth-context';
import { LoginPage } from './auth/login-page';
import { RegisterPage } from './auth/register-page';
import { Layout } from './components/layout';
import { ProjectListPage } from './projects/project-list-page';
import { ProjectDetailPage } from './projects/project-detail-page';
import { SearchPage } from './search/search-page';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<ProjectListPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="search" element={<SearchPage />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 3: Write layout with sidebar**

```tsx
// packages/web-app/src/components/layout.tsx
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

export function Layout() {
  const { logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { path: '/', label: '项目' },
    { path: '/search', label: '搜索' },
  ];

  return (
    <div className="flex h-screen">
      <aside className="w-56 bg-gray-900 text-white flex flex-col">
        <div className="p-4 text-lg font-bold border-b border-gray-700">Agent FS</div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(item => (
            <Link key={item.path} to={item.path}
              className={`block px-3 py-2 rounded ${location.pathname === item.path ? 'bg-gray-700' : 'hover:bg-gray-800'}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <button onClick={logout} className="p-4 text-sm text-gray-400 hover:text-white border-t border-gray-700">
          退出登录
        </button>
      </aside>
      <main className="flex-1 overflow-auto bg-gray-50 p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Write project list page**

```tsx
// packages/web-app/src/projects/project-list-page.tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export function ProjectListPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    api<any>('/projects').then(d => setProjects(d.projects));
  }, []);

  const createProject = async () => {
    if (!newName.trim()) return;
    const result = await api<any>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: newName }),
    });
    setProjects(prev => [result, ...prev]);
    setNewName('');
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">知识库项目</h1>
      <div className="flex gap-2 mb-6">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="新项目名称"
          className="flex-1 px-3 py-2 border rounded-md" />
        <button onClick={createProject} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
          创建
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(p => (
          <Link key={p.id} to={`/projects/${p.id}`}
            className="block p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow">
            <h2 className="font-semibold">{p.name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              创建于 {new Date(p.created_at).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write project detail page (files + upload)**

```tsx
// packages/web-app/src/projects/project-detail-page.tsx
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api, uploadFiles } from '../api/client';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [files, setFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (id) api<any>(`/projects/${id}/files`).then(d => setFiles(d.files));
  }, [id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !id) return;
    setUploading(true);
    try {
      await uploadFiles(id, Array.from(e.target.files));
      const data = await api<any>(`/projects/${id}/files`);
      setFiles(data.files);
    } finally {
      setUploading(false);
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case 'pending': return '⏳ 等待索引';
      case 'indexing': return '🔄 索引中';
      case 'indexed': return '✅ 已索引';
      case 'failed': return '❌ 失败';
      default: return s;
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">项目文件</h1>
      <div className="mb-6">
        <label className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md cursor-pointer hover:bg-blue-700">
          {uploading ? '上传中...' : '上传文件'}
          <input type="file" multiple onChange={handleUpload} className="hidden" disabled={uploading} />
        </label>
      </div>
      <table className="w-full bg-white rounded-lg shadow">
        <thead>
          <tr className="border-b text-left text-sm text-gray-500">
            <th className="p-3">文件名</th>
            <th className="p-3">大小</th>
            <th className="p-3">Chunks</th>
            <th className="p-3">状态</th>
            <th className="p-3">索引时间</th>
          </tr>
        </thead>
        <tbody>
          {files.map(f => (
            <tr key={f.id} className="border-b hover:bg-gray-50">
              <td className="p-3 font-medium">{f.name}</td>
              <td className="p-3 text-sm text-gray-500">{(f.size_bytes / 1024).toFixed(1)} KB</td>
              <td className="p-3 text-sm">{f.chunk_count}</td>
              <td className="p-3 text-sm">{statusLabel(f.status)}</td>
              <td className="p-3 text-sm text-gray-500">
                {f.indexed_at ? new Date(f.indexed_at).toLocaleString() : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/web-app/src/
git commit -m "feat(web-app): add router, layout, project list and detail pages with file upload"
```

---

### Task 5: Search Page

**Files:**
- Create: `packages/web-app/src/search/search-page.tsx`

- [ ] **Step 1: Write search page**

```tsx
// packages/web-app/src/search/search-page.tsx
import { useState } from 'react';
import { api } from '../api/client';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await api<any>('/search', {
        method: 'POST',
        body: JSON.stringify({ query, keyword: keyword || undefined, topK: 10 }),
      });
      setResults(data.results);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">搜索知识库</h1>
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="语义查询..."
          className="flex-1 px-3 py-2 border rounded-md" required />
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="关键词（可选）"
          className="w-48 px-3 py-2 border rounded-md" />
        <button type="submit" disabled={searching}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
          {searching ? '搜索中...' : '搜索'}
        </button>
      </form>
      <div className="space-y-3">
        {results.map((r: any, i: number) => (
          <div key={i} className="bg-white p-4 rounded-lg shadow">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-blue-600">{r.chunkId || r.chunk_id}</span>
              <span className="text-xs text-gray-400">Score: {r.score?.toFixed(4)}</span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.content || r.document?.file_path || '-'}</p>
          </div>
        ))}
        {results.length === 0 && query && !searching && (
          <p className="text-gray-400 text-center py-8">无搜索结果</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and test dev server**

```bash
cd /Users/weidwonder/projects/agent_fs/packages/web-app && pnpm dev
```

Verify pages load at `http://localhost:5173`.

- [ ] **Step 3: Commit**

```bash
git add packages/web-app/src/search/
git commit -m "feat(web-app): add search page with semantic + keyword search"
```

---

### Task 6: Server Static Hosting

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Add static file serving in production**

In `app.ts`, add after route registration:

```typescript
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';

// Serve web-app static files in production
const webAppDist = join(dirname(fileURLToPath(import.meta.url)), '../../web-app/dist');
if (existsSync(webAppDist)) {
  await app.register(fastifyStatic, { root: webAppDist, prefix: '/' });
  // SPA fallback
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api') || request.url.startsWith('/mcp') || request.url.startsWith('/auth')) {
      reply.status(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });
}
```

Add `@fastify/static` to `packages/server/package.json` dependencies.

- [ ] **Step 2: Build web-app + test**

```bash
cd /Users/weidwonder/projects/agent_fs/packages/web-app && pnpm build
cd ../server && pnpm build && node dist/index.js --mode=server
```

Verify `http://localhost:3000` serves the SPA.

- [ ] **Step 3: Commit**

```bash
git add packages/server/ packages/web-app/
git commit -m "feat(server): serve web-app static files in production mode"
```

---

## Phase 5 Success Criteria

- [ ] Web UI builds and runs via `pnpm dev`
- [ ] Register / Login flow works with JWT
- [ ] Project CRUD: create, list, delete
- [ ] File upload triggers indexing
- [ ] Search page returns results
- [ ] Server serves SPA static files in production
