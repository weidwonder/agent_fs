-- packages/storage-cloud/src/migrations/001-init-schema.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Users & Tenants ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  oauth_provider TEXT,
  oauth_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  storage_quota_bytes BIGINT NOT NULL DEFAULT 10737418240,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Knowledge Base Structure ────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);

CREATE TABLE IF NOT EXISTS directories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_dir_id UUID REFERENCES directories(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE (project_id, relative_path)
);
CREATE INDEX IF NOT EXISTS idx_directories_project ON directories(project_id);
CREATE INDEX IF NOT EXISTS idx_directories_tenant ON directories(tenant_id);

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directory_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  hash TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  chunk_count INT NOT NULL DEFAULT 0,
  summary TEXT,
  afd_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'indexed', 'failed')),
  indexed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_files_directory ON files(directory_id);
CREATE INDEX IF NOT EXISTS idx_files_tenant ON files(tenant_id);

-- ─── Vector Storage (replaces LanceDB) ──────────────────────

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  dir_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rel_path TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  chunk_line_start INT NOT NULL DEFAULT 0,
  chunk_line_end INT NOT NULL DEFAULT 0,
  locator TEXT NOT NULL DEFAULT '',
  content_vector vector(1024),
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chunks_hnsw ON chunks
  USING hnsw (content_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_chunks_dir ON chunks(dir_id);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON chunks(tenant_id);

-- ─── Inverted Index (replaces SQLite) ────────────────────────

CREATE TABLE IF NOT EXISTS inverted_terms (
  id BIGSERIAL PRIMARY KEY,
  term TEXT NOT NULL,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  dir_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  chunk_id TEXT NOT NULL,
  locator TEXT NOT NULL DEFAULT '',
  tf REAL NOT NULL DEFAULT 0,
  positions INT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_inverted_term_dir ON inverted_terms(term, dir_id);
CREATE INDEX IF NOT EXISTS idx_inverted_file ON inverted_terms(file_id);
CREATE INDEX IF NOT EXISTS idx_inverted_tenant ON inverted_terms(tenant_id);

-- Per-directory stats for BM25 normalization
CREATE TABLE IF NOT EXISTS inverted_stats (
  dir_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  total_docs INT NOT NULL DEFAULT 0,
  avg_doc_length REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (dir_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_inverted_stats_tenant ON inverted_stats(tenant_id);
