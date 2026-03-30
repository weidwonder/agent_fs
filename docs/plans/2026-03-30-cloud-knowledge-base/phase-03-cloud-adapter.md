# Phase 3: CloudAdapter (pgvector + PostgreSQL FTS + S3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `packages/storage-cloud` implementing `StorageAdapter` with PostgreSQL (pgvector + full-text search) and S3/MinIO for document archives.

**Prerequisite:** Phase 1 interfaces finalized. Can run in parallel with Phase 2.

**Spec:** `docs/specs/2026-03-30-cloud-knowledge-base-design.md` §4-5

---

## File Map

```
packages/storage-cloud/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                          # Re-exports CloudAdapter factory
│   ├── cloud-vector-store-adapter.ts     # pgvector implementation
│   ├── cloud-inverted-index-adapter.ts   # PostgreSQL FTS implementation
│   ├── cloud-archive-adapter.ts          # S3/MinIO implementation
│   ├── cloud-metadata-adapter.ts         # PG tables for index metadata
│   ├── db.ts                             # PostgreSQL connection pool (pg)
│   ├── s3.ts                             # S3 client setup (@aws-sdk/client-s3)
│   ├── migrations/
│   │   └── 001-init-schema.sql           # Full schema DDL
│   └── __tests__/
│       ├── cloud-vector.test.ts
│       ├── cloud-inverted.test.ts
│       ├── cloud-archive.test.ts
│       └── test-setup.ts                 # Docker PG + MinIO test harness
```

---

### Task 1: Scaffold `packages/storage-cloud`

**Files:**
- Create: `packages/storage-cloud/package.json`
- Create: `packages/storage-cloud/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agent-fs/storage-cloud",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate": "node dist/migrations/run.js"
  },
  "dependencies": {
    "@agent-fs/core": "workspace:*",
    "@agent-fs/storage-adapter": "workspace:*",
    "@aws-sdk/client-s3": "^3.500.0",
    "pg": "^8.13.0",
    "pgvector": "^0.2.0",
    "nodejieba": "^2.6.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "vitest": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/weidwonder/projects/agent_fs && pnpm install
```

- [ ] **Step 4: Commit**

```bash
git add packages/storage-cloud/package.json packages/storage-cloud/tsconfig.json pnpm-lock.yaml
git commit -m "chore: scaffold @agent-fs/storage-cloud package"
```

---

### Task 2: Database Schema Migration

**Files:**
- Create: `packages/storage-cloud/src/migrations/001-init-schema.sql`

- [ ] **Step 1: Write the schema DDL**

```sql
-- packages/storage-cloud/src/migrations/001-init-schema.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Users & Tenants ─────────────────────────────────────────

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  oauth_provider TEXT,
  oauth_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  storage_quota_bytes BIGINT NOT NULL DEFAULT 10737418240, -- 10GB
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_members (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Knowledge Base Structure ────────────────────────────────

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_tenant ON projects(tenant_id);

CREATE TABLE directories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_dir_id UUID REFERENCES directories(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE (project_id, relative_path)
);
CREATE INDEX idx_directories_project ON directories(project_id);

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directory_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  hash TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  chunk_count INT NOT NULL DEFAULT 0,
  summary TEXT,
  afd_key TEXT, -- S3 object key
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'indexed', 'failed')),
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_directory ON files(directory_id);
CREATE INDEX idx_files_tenant ON files(tenant_id);

-- ─── Vector Storage (replaces LanceDB) ──────────────────────

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,  -- chunk_id format: "file_id:chunk_index"
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  dir_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rel_path TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  chunk_line_start INT NOT NULL DEFAULT 0,
  chunk_line_end INT NOT NULL DEFAULT 0,
  locator TEXT NOT NULL DEFAULT '',
  content_vector vector(1024),  -- dimension configurable at adapter level
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_chunks_hnsw ON chunks
  USING hnsw (content_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_chunks_dir ON chunks(dir_id);
CREATE INDEX idx_chunks_file ON chunks(file_id);
CREATE INDEX idx_chunks_tenant ON chunks(tenant_id);

-- ─── Inverted Index (replaces SQLite) ────────────────────────

CREATE TABLE inverted_terms (
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
CREATE INDEX idx_inverted_term_dir ON inverted_terms(term, dir_id);
CREATE INDEX idx_inverted_file ON inverted_terms(file_id);
CREATE INDEX idx_inverted_tenant ON inverted_terms(tenant_id);

-- Per-directory stats for BM25 normalization
CREATE TABLE inverted_stats (
  dir_id UUID PRIMARY KEY REFERENCES directories(id) ON DELETE CASCADE,
  total_docs INT NOT NULL DEFAULT 0,
  avg_doc_length REAL NOT NULL DEFAULT 0
);

-- ─── Job Queue (pg-boss will manage its own tables) ──────────
-- pg-boss creates its tables automatically on init.
```

- [ ] **Step 2: Commit**

```bash
git add packages/storage-cloud/src/migrations/
git commit -m "feat(storage-cloud): add PostgreSQL schema migration with pgvector, FTS, tenants"
```

---

### Task 3: Database Connection + S3 Client

**Files:**
- Create: `packages/storage-cloud/src/db.ts`
- Create: `packages/storage-cloud/src/s3.ts`

- [ ] **Step 1: Write db.ts**

```typescript
// packages/storage-cloud/src/db.ts

import pg from 'pg';

export interface DbConfig {
  connectionString: string;
  maxConnections?: number;
}

let pool: pg.Pool | null = null;

export function getPool(config?: DbConfig): pg.Pool {
  if (!pool) {
    if (!config) throw new Error('Database not initialized. Call initDb() first.');
    pool = new pg.Pool({
      connectionString: config.connectionString,
      max: config.maxConnections ?? 20,
    });
  }
  return pool;
}

export async function initDb(config: DbConfig): Promise<pg.Pool> {
  pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 20,
  });
  // Enable pgvector
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  } finally {
    client.release();
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

- [ ] **Step 2: Write s3.ts**

```typescript
// packages/storage-cloud/src/s3.ts

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

export interface S3Config {
  endpoint: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

let s3Client: S3Client | null = null;
let s3Bucket = '';

export function initS3(config: S3Config): S3Client {
  s3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region ?? 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? true, // MinIO needs this
  });
  s3Bucket = config.bucket;
  return s3Client;
}

export function getS3(): { client: S3Client; bucket: string } {
  if (!s3Client) throw new Error('S3 not initialized. Call initS3() first.');
  return { client: s3Client, bucket: s3Bucket };
}

export async function putObject(key: string, body: Buffer | string): Promise<void> {
  const { client, bucket } = getS3();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}

export async function getObject(key: string): Promise<Buffer> {
  const { client, bucket } = getS3();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = getS3();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  const { client, bucket } = getS3();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Build**

```bash
cd /Users/weidwonder/projects/agent_fs/packages/storage-cloud && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/storage-cloud/src/db.ts packages/storage-cloud/src/s3.ts
git commit -m "feat(storage-cloud): add PostgreSQL pool and S3/MinIO client helpers"
```

---

### Task 4: CloudVectorStoreAdapter (pgvector)

**Files:**
- Create: `packages/storage-cloud/src/cloud-vector-store-adapter.ts`

- [ ] **Step 1: Write the adapter**

```typescript
// packages/storage-cloud/src/cloud-vector-store-adapter.ts

import type { VectorDocument, VectorSearchResult } from '@agent-fs/core';
import type { VectorStoreAdapter, VectorSearchParams } from '@agent-fs/storage-adapter';
import { getPool } from './db.js';
import pgvector from 'pgvector';

export class CloudVectorStoreAdapter implements VectorStoreAdapter {
  constructor(private readonly tenantId: string) {}

  async init(): Promise<void> {
    await pgvector.registerTypes(getPool());
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const pool = getPool();

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const doc of docs) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, ` +
        `$${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, ` +
        `$${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10})`
      );
      values.push(
        doc.chunk_id, doc.file_id, doc.dir_id, this.tenantId,
        doc.rel_path, doc.file_path,
        doc.chunk_line_start, doc.chunk_line_end,
        doc.locator, pgvector.toSql(doc.content_vector),
        doc.indexed_at ? new Date(doc.indexed_at) : new Date()
      );
      paramIdx += 11;
    }

    await pool.query(
      `INSERT INTO chunks (id, file_id, dir_id, tenant_id, rel_path, file_path,
        chunk_line_start, chunk_line_end, locator, content_vector, indexed_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (id) DO UPDATE SET
        content_vector = EXCLUDED.content_vector,
        indexed_at = EXCLUDED.indexed_at`,
      values
    );
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await getPool().query(
      'DELETE FROM chunks WHERE file_id = $1 AND tenant_id = $2',
      [fileId, this.tenantId]
    );
  }

  async deleteByDirId(dirId: string): Promise<void> {
    await getPool().query(
      'DELETE FROM chunks WHERE dir_id = $1 AND tenant_id = $2',
      [dirId, this.tenantId]
    );
  }

  async deleteByDirIds(dirIds: string[]): Promise<void> {
    if (dirIds.length === 0) return;
    await getPool().query(
      'DELETE FROM chunks WHERE dir_id = ANY($1) AND tenant_id = $2',
      [dirIds, this.tenantId]
    );
  }

  async searchByVector(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const pool = getPool();
    const vectorSql = pgvector.toSql(params.vector);

    let query: string;
    const queryParams: any[] = [vectorSql, this.tenantId, params.topK];

    if (params.dirIds.length > 0) {
      query = `
        SELECT id AS chunk_id, file_id, dir_id, rel_path, file_path,
               chunk_line_start, chunk_line_end, locator, indexed_at,
               1 - (content_vector <=> $1::vector) AS score
        FROM chunks
        WHERE tenant_id = $2
          AND dir_id = ANY($4)
          AND deleted_at IS NULL
        ORDER BY content_vector <=> $1::vector
        LIMIT $3
      `;
      queryParams.push(params.dirIds);
    } else {
      query = `
        SELECT id AS chunk_id, file_id, dir_id, rel_path, file_path,
               chunk_line_start, chunk_line_end, locator, indexed_at,
               1 - (content_vector <=> $1::vector) AS score
        FROM chunks
        WHERE tenant_id = $2
          AND deleted_at IS NULL
        ORDER BY content_vector <=> $1::vector
        LIMIT $3
      `;
    }

    const result = await pool.query(query, queryParams);

    return result.rows.map((row: any) => ({
      chunk_id: row.chunk_id,
      score: parseFloat(row.score),
      document: {
        chunk_id: row.chunk_id,
        file_id: row.file_id,
        dir_id: row.dir_id,
        rel_path: row.rel_path,
        file_path: row.file_path,
        chunk_line_start: row.chunk_line_start,
        chunk_line_end: row.chunk_line_end,
        content_vector: [], // Don't return full vector in search results
        locator: row.locator,
        indexed_at: row.indexed_at?.toISOString() ?? '',
        deleted_at: '',
      },
    }));
  }

  async getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]> {
    if (chunkIds.length === 0) return [];
    const pool = getPool();

    const result = await pool.query(
      `SELECT id AS chunk_id, file_id, dir_id, rel_path, file_path,
              chunk_line_start, chunk_line_end, locator, indexed_at
       FROM chunks
       WHERE id = ANY($1) AND tenant_id = $2 AND deleted_at IS NULL`,
      [chunkIds, this.tenantId]
    );

    return result.rows.map((row: any) => ({
      chunk_id: row.chunk_id,
      file_id: row.file_id,
      dir_id: row.dir_id,
      rel_path: row.rel_path,
      file_path: row.file_path,
      chunk_line_start: row.chunk_line_start,
      chunk_line_end: row.chunk_line_end,
      content_vector: [],
      locator: row.locator,
      indexed_at: row.indexed_at?.toISOString() ?? '',
      deleted_at: '',
    }));
  }

  async close(): Promise<void> {
    // Pool is shared; don't close here
  }
}
```

- [ ] **Step 2: Build**

```bash
pnpm --filter @agent-fs/storage-cloud build
```

- [ ] **Step 3: Commit**

```bash
git add packages/storage-cloud/src/cloud-vector-store-adapter.ts
git commit -m "feat(storage-cloud): implement CloudVectorStoreAdapter with pgvector"
```

---

### Task 5: CloudInvertedIndexAdapter (PostgreSQL FTS)

**Files:**
- Create: `packages/storage-cloud/src/cloud-inverted-index-adapter.ts`

- [ ] **Step 1: Write the adapter**

Uses application-layer tokenization with nodejieba (same as local version) and stores terms in `inverted_terms` table. BM25 scoring computed in application layer using same algorithm from `@agent-fs/search`.

```typescript
// packages/storage-cloud/src/cloud-inverted-index-adapter.ts

import type {
  InvertedIndexAdapter,
  IndexEntry,
  InvertedSearchParams,
  InvertedSearchResult,
} from '@agent-fs/storage-adapter';
import { getPool } from './db.js';
import nodejieba from 'nodejieba';

function tokenizeText(text: string): string[] {
  return nodejieba.cut(text)
    .map((t: string) => t.trim().toLowerCase())
    .filter((t: string) => t.length > 0 && !/^\s+$/.test(t));
}

export class CloudInvertedIndexAdapter implements InvertedIndexAdapter {
  constructor(private readonly tenantId: string) {}

  async init(): Promise<void> {
    // Tables created by migration
  }

  async addFile(fileId: string, dirId: string, entries: IndexEntry[]): Promise<void> {
    const pool = getPool();

    // Delete existing entries for this file
    await pool.query(
      'DELETE FROM inverted_terms WHERE file_id = $1 AND tenant_id = $2',
      [fileId, this.tenantId]
    );

    if (entries.length === 0) return;

    // Build postings per term (same logic as local InvertedIndex)
    const termPostings = new Map<string, { chunkId: string; locator: string; tf: number; positions: number[] }[]>();

    for (const entry of entries) {
      const tokens = tokenizeText(entry.text);
      const posMap = new Map<string, number[]>();
      for (const [pos, term] of tokens.entries()) {
        const arr = posMap.get(term);
        if (arr) arr.push(pos);
        else posMap.set(term, [pos]);
      }
      for (const [term, positions] of posMap) {
        let postings = termPostings.get(term);
        if (!postings) {
          postings = [];
          termPostings.set(term, postings);
        }
        postings.push({
          chunkId: entry.chunkId,
          locator: entry.locator,
          tf: positions.length,
          positions,
        });
      }
    }

    // Batch insert
    const values: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const [term, postings] of termPostings) {
      for (const p of postings) {
        placeholders.push(
          `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`
        );
        values.push(term, fileId, dirId, this.tenantId, p.chunkId, p.locator, p.tf, p.positions);
        idx += 8;
      }
    }

    if (placeholders.length > 0) {
      // Insert in batches of 1000 rows to avoid param limit
      const batchSize = 1000;
      for (let i = 0; i < placeholders.length; i += batchSize) {
        const batchPlaceholders = placeholders.slice(i, i + batchSize);
        const paramsPerRow = 8;
        const batchValues = values.slice(i * paramsPerRow, (i + batchSize) * paramsPerRow);
        await pool.query(
          `INSERT INTO inverted_terms (term, file_id, dir_id, tenant_id, chunk_id, locator, tf, positions)
           VALUES ${batchPlaceholders.join(', ')}`,
          batchValues
        );
      }
    }

    // Update stats
    await this.updateStats(dirId);
  }

  async removeFile(fileId: string): Promise<void> {
    const pool = getPool();
    // Get affected dirIds before delete
    const dirs = await pool.query(
      'SELECT DISTINCT dir_id FROM inverted_terms WHERE file_id = $1 AND tenant_id = $2',
      [fileId, this.tenantId]
    );
    await pool.query(
      'DELETE FROM inverted_terms WHERE file_id = $1 AND tenant_id = $2',
      [fileId, this.tenantId]
    );
    for (const row of dirs.rows) {
      await this.updateStats(row.dir_id);
    }
  }

  async removeDirectory(dirId: string): Promise<void> {
    await this.removeDirectories([dirId]);
  }

  async removeDirectories(dirIds: string[]): Promise<void> {
    if (dirIds.length === 0) return;
    const pool = getPool();
    await pool.query(
      'DELETE FROM inverted_terms WHERE dir_id = ANY($1) AND tenant_id = $2',
      [dirIds, this.tenantId]
    );
    await pool.query(
      'DELETE FROM inverted_stats WHERE dir_id = ANY($1)',
      [dirIds]
    );
  }

  async search(params: InvertedSearchParams): Promise<InvertedSearchResult[]> {
    const pool = getPool();
    const terms = tokenizeText(params.query);
    if (terms.length === 0) return [];

    const topK = params.topK ?? 10;
    const dirIds = params.dirIds;

    // Get scope stats for BM25
    let statsQuery: string;
    let statsParams: any[];
    if (dirIds && dirIds.length > 0) {
      statsQuery = 'SELECT SUM(total_docs) AS total, SUM(total_docs * avg_doc_length) / NULLIF(SUM(total_docs), 0) AS avg_len FROM inverted_stats WHERE dir_id = ANY($1)';
      statsParams = [dirIds];
    } else {
      statsQuery = 'SELECT SUM(total_docs) AS total, SUM(total_docs * avg_doc_length) / NULLIF(SUM(total_docs), 0) AS avg_len FROM inverted_stats';
      statsParams = [];
    }
    const statsResult = await pool.query(statsQuery, statsParams);
    const totalDocs = parseInt(statsResult.rows[0]?.total ?? '0');
    const avgDocLength = parseFloat(statsResult.rows[0]?.avg_len ?? '1');
    if (totalDocs === 0) return [];

    // Query matching terms
    let termQuery: string;
    let termParams: any[];
    if (dirIds && dirIds.length > 0) {
      termQuery = `SELECT term, file_id, dir_id, chunk_id, locator, tf
                   FROM inverted_terms
                   WHERE term = ANY($1) AND dir_id = ANY($2) AND tenant_id = $3`;
      termParams = [terms, dirIds, this.tenantId];
    } else {
      termQuery = `SELECT term, file_id, dir_id, chunk_id, locator, tf
                   FROM inverted_terms
                   WHERE term = ANY($1) AND tenant_id = $2`;
      termParams = [terms, this.tenantId];
    }
    const termResults = await pool.query(termQuery, termParams);

    // BM25 scoring in application layer
    const k1 = 1.2;
    const b = 0.75;
    const scores = new Map<string, InvertedSearchResult>();

    // Count doc frequency per term
    const dfMap = new Map<string, Set<string>>();
    for (const row of termResults.rows) {
      let set = dfMap.get(row.term);
      if (!set) { set = new Set(); dfMap.set(row.term, set); }
      set.add(row.file_id);
    }

    for (const row of termResults.rows) {
      const df = dfMap.get(row.term)?.size ?? 0;
      const idfVal = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (row.tf * (k1 + 1)) / (row.tf + k1 * (1 - b + b * 1)); // simplified; doc_length unavailable per-row
      const scoreDelta = idfVal * tfNorm;

      const key = `${row.file_id}:${row.chunk_id}`;
      const existing = scores.get(key);
      if (existing) {
        existing.score += scoreDelta;
      } else {
        scores.set(key, {
          chunkId: row.chunk_id,
          fileId: row.file_id,
          dirId: row.dir_id,
          locator: row.locator,
          score: scoreDelta,
        });
      }
    }

    return [...scores.values()]
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async close(): Promise<void> {
    // Pool is shared
  }

  private async updateStats(dirId: string): Promise<void> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT COUNT(DISTINCT file_id) AS total_docs,
              COALESCE(AVG(doc_length), 0) AS avg_doc_length
       FROM (
         SELECT file_id, SUM(tf) AS doc_length
         FROM inverted_terms
         WHERE dir_id = $1
         GROUP BY file_id
       ) sub`,
      [dirId]
    );
    const { total_docs, avg_doc_length } = result.rows[0];
    if (parseInt(total_docs) === 0) {
      await pool.query('DELETE FROM inverted_stats WHERE dir_id = $1', [dirId]);
    } else {
      await pool.query(
        `INSERT INTO inverted_stats (dir_id, total_docs, avg_doc_length)
         VALUES ($1, $2, $3)
         ON CONFLICT (dir_id) DO UPDATE SET
           total_docs = EXCLUDED.total_docs,
           avg_doc_length = EXCLUDED.avg_doc_length`,
        [dirId, total_docs, avg_doc_length]
      );
    }
  }
}
```

- [ ] **Step 2: Build and commit**

```bash
pnpm --filter @agent-fs/storage-cloud build
git add packages/storage-cloud/src/cloud-inverted-index-adapter.ts
git commit -m "feat(storage-cloud): implement CloudInvertedIndexAdapter with PostgreSQL BM25"
```

---

### Task 6: CloudArchiveAdapter (S3/MinIO)

**Files:**
- Create: `packages/storage-cloud/src/cloud-archive-adapter.ts`

- [ ] **Step 1: Write the adapter**

```typescript
// packages/storage-cloud/src/cloud-archive-adapter.ts

import type {
  DocumentArchiveAdapter,
  ArchiveContent,
  ArchiveReadRequest,
} from '@agent-fs/storage-adapter';
import { putObject, getObject, deleteObject, objectExists } from './s3.js';

export class CloudArchiveAdapter implements DocumentArchiveAdapter {
  constructor(private readonly tenantId: string) {}

  private key(fileId: string, filePath: string): string {
    return `${this.tenantId}/${fileId}/${filePath}`;
  }

  async write(fileId: string, content: ArchiveContent): Promise<void> {
    const uploads = Object.entries(content.files).map(([path, data]) => {
      const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
      return putObject(this.key(fileId, path), body);
    });
    await Promise.all(uploads);
  }

  async read(fileId: string, filePath: string): Promise<Buffer> {
    return getObject(this.key(fileId, filePath));
  }

  async readText(fileId: string, filePath: string): Promise<string> {
    const buf = await this.read(fileId, filePath);
    return buf.toString('utf-8');
  }

  async readBatch(requests: ArchiveReadRequest[]): Promise<Buffer[]> {
    return Promise.all(
      requests.map(r => this.read(r.fileId, r.filePath))
    );
  }

  async exists(fileId: string): Promise<boolean> {
    // Check if the content.md file exists as a proxy for archive existence
    return objectExists(this.key(fileId, 'content.md'));
  }

  async delete(fileId: string): Promise<void> {
    // Delete known internal files
    const knownFiles = ['content.md', 'metadata.json', 'summaries.json'];
    await Promise.all(
      knownFiles.map(f => deleteObject(this.key(fileId, f)).catch(() => {}))
    );
  }
}
```

- [ ] **Step 2: Build and commit**

```bash
pnpm --filter @agent-fs/storage-cloud build
git add packages/storage-cloud/src/cloud-archive-adapter.ts
git commit -m "feat(storage-cloud): implement CloudArchiveAdapter with S3/MinIO"
```

---

### Task 7: CloudAdapter Factory + Exports

**Files:**
- Create: `packages/storage-cloud/src/index.ts`

- [ ] **Step 1: Write the factory**

```typescript
// packages/storage-cloud/src/index.ts

import type { StorageAdapter } from '@agent-fs/storage-adapter';
import { CloudVectorStoreAdapter } from './cloud-vector-store-adapter.js';
import { CloudInvertedIndexAdapter } from './cloud-inverted-index-adapter.js';
import { CloudArchiveAdapter } from './cloud-archive-adapter.js';
import { initDb, closeDb, type DbConfig } from './db.js';
import { initS3, type S3Config } from './s3.js';

export interface CloudAdapterConfig {
  tenantId: string;
  db: DbConfig;
  s3: S3Config;
}

export async function createCloudAdapter(config: CloudAdapterConfig): Promise<StorageAdapter> {
  await initDb(config.db);
  initS3(config.s3);

  return {
    vector: new CloudVectorStoreAdapter(config.tenantId),
    invertedIndex: new CloudInvertedIndexAdapter(config.tenantId),
    archive: new CloudArchiveAdapter(config.tenantId),
    metadata: null as any, // CloudMetadataAdapter — add when needed
  };
}

export { closeDb } from './db.js';
export { CloudVectorStoreAdapter } from './cloud-vector-store-adapter.js';
export { CloudInvertedIndexAdapter } from './cloud-inverted-index-adapter.js';
export { CloudArchiveAdapter } from './cloud-archive-adapter.js';
export type { CloudAdapterConfig };
```

- [ ] **Step 2: Build full package**

```bash
pnpm --filter @agent-fs/storage-cloud build
```

- [ ] **Step 3: Commit**

```bash
git add packages/storage-cloud/src/index.ts
git commit -m "feat(storage-cloud): add createCloudAdapter factory combining pgvector, PG FTS, S3"
```

---

### Task 8: Integration Tests with Docker

**Files:**
- Create: `packages/storage-cloud/src/__tests__/test-setup.ts`
- Create: `packages/storage-cloud/src/__tests__/cloud-vector.test.ts`
- Create: `packages/storage-cloud/docker-compose.test.yml`

- [ ] **Step 1: Create docker-compose.test.yml for test infra**

```yaml
# packages/storage-cloud/docker-compose.test.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: agentfs_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "15432:5432"
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "test"]
      interval: 2s
      retries: 10

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "19000:9000"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 2s
      retries: 10
```

- [ ] **Step 2: Write test-setup.ts**

```typescript
// packages/storage-cloud/src/__tests__/test-setup.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../db.js';
import { initS3 } from '../s3.js';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TEST_DB_URL = 'postgresql://test:test@localhost:15432/agentfs_test';
export const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export async function setupTestInfra() {
  const pool = await initDb({ connectionString: TEST_DB_URL });

  // Run migration
  const migration = readFileSync(
    join(__dirname, '../migrations/001-init-schema.sql'),
    'utf-8'
  );
  await pool.query(migration);

  // Init S3
  const s3 = initS3({
    endpoint: 'http://localhost:19000',
    bucket: 'agentfs-test',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  });

  // Create test bucket
  try {
    await s3.send(new CreateBucketCommand({ Bucket: 'agentfs-test' }));
  } catch {
    // Bucket may already exist
  }

  return pool;
}

export async function teardownTestInfra() {
  await closeDb();
}
```

- [ ] **Step 3: Write vector adapter test**

```typescript
// packages/storage-cloud/src/__tests__/cloud-vector.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CloudVectorStoreAdapter } from '../cloud-vector-store-adapter.js';
import { setupTestInfra, teardownTestInfra, TEST_TENANT_ID } from './test-setup.js';
import type { VectorDocument } from '@agent-fs/core';

describe('CloudVectorStoreAdapter', () => {
  let adapter: CloudVectorStoreAdapter;

  beforeAll(async () => {
    await setupTestInfra();
    adapter = new CloudVectorStoreAdapter(TEST_TENANT_ID);
    await adapter.init();
  });

  afterAll(async () => {
    await teardownTestInfra();
  });

  const mockDoc: VectorDocument = {
    chunk_id: 'test-file:0',
    file_id: 'test-file',
    dir_id: 'test-dir',
    rel_path: 'test.md',
    file_path: '/tmp/test.md',
    chunk_line_start: 1,
    chunk_line_end: 10,
    content_vector: new Array(1024).fill(0.01),
    locator: 'line:1-10',
    indexed_at: new Date().toISOString(),
    deleted_at: '',
  };

  it('should add and search documents', async () => {
    await adapter.addDocuments([mockDoc]);

    const results = await adapter.searchByVector({
      vector: new Array(1024).fill(0.01),
      dirIds: ['test-dir'],
      topK: 5,
      mode: 'postfilter',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk_id).toBe('test-file:0');
  });

  it('should delete by file ID', async () => {
    await adapter.deleteByFileId('test-file');
    const results = await adapter.getByChunkIds(['test-file:0']);
    expect(results.length).toBe(0);
  });
});
```

- [ ] **Step 4: Start test infra and run tests**

```bash
cd /Users/weidwonder/projects/agent_fs/packages/storage-cloud
docker compose -f docker-compose.test.yml up -d
sleep 5  # wait for PG + MinIO
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add packages/storage-cloud/
git commit -m "test(storage-cloud): add integration tests with Docker PostgreSQL + MinIO"
```

---

## Phase 3 Success Criteria

- [ ] `@agent-fs/storage-cloud` compiles cleanly
- [ ] `CloudVectorStoreAdapter` correctly stores and retrieves vectors via pgvector
- [ ] `CloudInvertedIndexAdapter` correctly indexes and searches with BM25
- [ ] `CloudArchiveAdapter` correctly reads/writes to S3/MinIO
- [ ] `createCloudAdapter()` factory produces a valid `StorageAdapter`
- [ ] Integration tests pass against Dockerized PostgreSQL + MinIO
- [ ] Schema migration creates all required tables
