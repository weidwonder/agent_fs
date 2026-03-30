# Phase 1: Storage Adapter Interfaces + LocalAdapter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `packages/storage-adapter` with adapter interfaces and a `LocalAdapter` that wraps existing LanceDB/SQLite/AFD implementations.

**Spec:** `docs/specs/2026-03-30-cloud-knowledge-base-design.md` §4

---

## File Map

```
packages/storage-adapter/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                          # Re-exports all interfaces and LocalAdapter
│   ├── types.ts                          # Adapter interfaces
│   ├── local/
│   │   ├── index.ts                      # LocalAdapter (combines 3 sub-adapters)
│   │   ├── local-vector-store-adapter.ts # Wraps @agent-fs/search VectorStore
│   │   ├── local-inverted-index-adapter.ts # Wraps @agent-fs/search InvertedIndex
│   │   └── local-archive-adapter.ts      # Wraps @agent-fs/storage AFDStorage
│   └── __tests__/
│       └── local-adapter.test.ts         # Integration tests with real backends
```

---

### Task 1: Scaffold `packages/storage-adapter`

**Files:**
- Create: `packages/storage-adapter/package.json`
- Create: `packages/storage-adapter/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agent-fs/storage-adapter",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@agent-fs/core": "workspace:*"
  },
  "devDependencies": {
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

- [ ] **Step 3: Run pnpm install**

```bash
cd /Users/weidwonder/projects/agent_fs && pnpm install
```

Expected: New package linked in workspace, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/storage-adapter/package.json packages/storage-adapter/tsconfig.json pnpm-lock.yaml
git commit -m "chore: scaffold @agent-fs/storage-adapter package"
```

---

### Task 2: Define Adapter Interfaces

**Files:**
- Create: `packages/storage-adapter/src/types.ts`
- Create: `packages/storage-adapter/src/index.ts`

**Context:** These interfaces abstract the three storage layers currently used directly by indexer/search. The method signatures are derived from the existing `VectorStore`, `InvertedIndex`, and `AFDStorage` APIs, but simplified to be backend-agnostic.

- [ ] **Step 1: Write `types.ts` with all adapter interfaces**

```typescript
// packages/storage-adapter/src/types.ts

import type { VectorDocument, VectorSearchResult } from '@agent-fs/core';

// ─── Vector Store Adapter ────────────────────────────────────

export interface VectorSearchParams {
  /** Query vector */
  vector: number[];
  /** Directory IDs to filter (OR relation) */
  dirIds: string[];
  /** Max results */
  topK: number;
  /** Filter strategy */
  mode: 'prefilter' | 'postfilter';
  /** Threshold before falling back to prefilter */
  minResultsBeforeFallback?: number;
}

export interface VectorStoreAdapter {
  init(): Promise<void>;
  addDocuments(docs: VectorDocument[]): Promise<void>;
  deleteByFileId(fileId: string): Promise<void>;
  deleteByDirId(dirId: string): Promise<void>;
  deleteByDirIds(dirIds: string[]): Promise<void>;
  searchByVector(params: VectorSearchParams): Promise<VectorSearchResult[]>;
  getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]>;
  close(): Promise<void>;
}

// ─── Inverted Index Adapter ──────────────────────────────────

export interface IndexEntry {
  text: string;
  chunkId: string;
  locator: string;
}

export interface InvertedSearchParams {
  /** Search query text (will be tokenized by adapter) */
  query: string;
  /** Directory IDs to filter */
  dirIds?: string[];
  /** Max results */
  topK?: number;
}

export interface InvertedSearchResult {
  chunkId: string;
  fileId: string;
  dirId: string;
  locator: string;
  score: number;
}

export interface InvertedIndexAdapter {
  init(): Promise<void>;
  addFile(fileId: string, dirId: string, entries: IndexEntry[]): Promise<void>;
  removeFile(fileId: string): Promise<void>;
  removeDirectory(dirId: string): Promise<void>;
  removeDirectories(dirIds: string[]): Promise<void>;
  search(params: InvertedSearchParams): Promise<InvertedSearchResult[]>;
  close(): Promise<void>;
}

// ─── Document Archive Adapter ────────────────────────────────

export interface ArchiveContent {
  /** Files to write: key = internal path (e.g. "content.md"), value = content */
  files: Record<string, string | Buffer>;
}

export interface ArchiveReadRequest {
  fileId: string;
  filePath: string;
}

export interface DocumentArchiveAdapter {
  write(fileId: string, content: ArchiveContent): Promise<void>;
  read(fileId: string, filePath: string): Promise<Buffer>;
  readText(fileId: string, filePath: string): Promise<string>;
  readBatch(requests: ArchiveReadRequest[]): Promise<Buffer[]>;
  exists(fileId: string): Promise<boolean>;
  delete(fileId: string): Promise<void>;
}

// ─── Metadata Adapter (index.json / registry) ────────────────

export interface MetadataAdapter {
  /** Read index metadata for a directory. Returns null if not found. */
  readIndexMetadata(dirId: string): Promise<import('@agent-fs/core').IndexMetadata | null>;
  /** Write index metadata for a directory */
  writeIndexMetadata(dirId: string, metadata: import('@agent-fs/core').IndexMetadata): Promise<void>;
  /** Delete index metadata for a directory */
  deleteIndexMetadata(dirId: string): Promise<void>;
}

// ─── Combined Storage Adapter ────────────────────────────────

export interface StorageAdapter {
  vector: VectorStoreAdapter;
  invertedIndex: InvertedIndexAdapter;
  archive: DocumentArchiveAdapter;
  metadata: MetadataAdapter;
}
```

- [ ] **Step 2: Write `index.ts` re-exporting everything**

```typescript
// packages/storage-adapter/src/index.ts

export type {
  VectorStoreAdapter,
  VectorSearchParams,
  InvertedIndexAdapter,
  InvertedSearchParams,
  InvertedSearchResult,
  IndexEntry,
  DocumentArchiveAdapter,
  ArchiveContent,
  ArchiveReadRequest,
  MetadataAdapter,
  StorageAdapter,
} from './types.js';
```

- [ ] **Step 3: Build to verify types compile**

```bash
cd /Users/weidwonder/projects/agent_fs/packages/storage-adapter && pnpm build
```

Expected: Clean compilation, `dist/` generated with `.js` + `.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/storage-adapter/src/
git commit -m "feat(storage-adapter): define adapter interfaces for vector, inverted index, archive, metadata"
```

---

### Task 3: Implement LocalVectorStoreAdapter

**Files:**
- Create: `packages/storage-adapter/src/local/local-vector-store-adapter.ts`

**Context:** Thin wrapper over existing `VectorStore` from `@agent-fs/search`. The adapter translates from the adapter interface params to `VectorStore` method calls. First add `@agent-fs/search` as a dependency.

- [ ] **Step 1: Add peer dependency**

Add to `packages/storage-adapter/package.json`:
```json
"peerDependencies": {
  "@agent-fs/search": "workspace:*",
  "@agent-fs/storage": "workspace:*"
},
"peerDependenciesMeta": {
  "@agent-fs/search": { "optional": true },
  "@agent-fs/storage": { "optional": true }
}
```

Peer deps are optional because CloudAdapter won't need them. Run `pnpm install`.

- [ ] **Step 2: Write the adapter**

```typescript
// packages/storage-adapter/src/local/local-vector-store-adapter.ts

import type { VectorDocument, VectorSearchResult } from '@agent-fs/core';
import type { VectorStore } from '@agent-fs/search';
import type { VectorStoreAdapter, VectorSearchParams } from '../types.js';

export class LocalVectorStoreAdapter implements VectorStoreAdapter {
  constructor(private readonly store: VectorStore) {}

  async init(): Promise<void> {
    await this.store.init();
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    await this.store.addDocuments(docs);
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await this.store.deleteByFileId(fileId);
  }

  async deleteByDirId(dirId: string): Promise<void> {
    await this.store.deleteByDirId(dirId);
  }

  async deleteByDirIds(dirIds: string[]): Promise<void> {
    await this.store.deleteByDirIds(dirIds);
  }

  async searchByVector(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    return this.store.searchByContent(params.vector, {
      topK: params.topK,
      dirIds: params.dirIds,
      distanceType: 'cosine',
      minResultsBeforeFallback: params.minResultsBeforeFallback,
    });
  }

  async getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]> {
    return this.store.getByChunkIds(chunkIds);
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}
```

- [ ] **Step 3: Build to verify**

```bash
cd /Users/weidwonder/projects/agent_fs/packages/storage-adapter && pnpm build
```

Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add packages/storage-adapter/
git commit -m "feat(storage-adapter): implement LocalVectorStoreAdapter wrapping LanceDB VectorStore"
```

---

### Task 4: Implement LocalInvertedIndexAdapter

**Files:**
- Create: `packages/storage-adapter/src/local/local-inverted-index-adapter.ts`

- [ ] **Step 1: Write the adapter**

```typescript
// packages/storage-adapter/src/local/local-inverted-index-adapter.ts

import type { InvertedIndex } from '@agent-fs/search';
import type {
  InvertedIndexAdapter,
  IndexEntry,
  InvertedSearchParams,
  InvertedSearchResult,
} from '../types.js';

export class LocalInvertedIndexAdapter implements InvertedIndexAdapter {
  constructor(private readonly index: InvertedIndex) {}

  async init(): Promise<void> {
    await this.index.init();
  }

  async addFile(fileId: string, dirId: string, entries: IndexEntry[]): Promise<void> {
    await this.index.addFile(fileId, dirId, entries);
  }

  async removeFile(fileId: string): Promise<void> {
    await this.index.removeFile(fileId);
  }

  async removeDirectory(dirId: string): Promise<void> {
    await this.index.removeDirectory(dirId);
  }

  async removeDirectories(dirIds: string[]): Promise<void> {
    await this.index.removeDirectories(dirIds);
  }

  async search(params: InvertedSearchParams): Promise<InvertedSearchResult[]> {
    return this.index.search(params.query, {
      dirIds: params.dirIds,
      topK: params.topK,
    });
  }

  async close(): Promise<void> {
    await this.index.close();
  }
}
```

- [ ] **Step 2: Build and commit**

```bash
pnpm build
git add packages/storage-adapter/src/local/local-inverted-index-adapter.ts
git commit -m "feat(storage-adapter): implement LocalInvertedIndexAdapter wrapping SQLite InvertedIndex"
```

---

### Task 5: Implement LocalArchiveAdapter

**Files:**
- Create: `packages/storage-adapter/src/local/local-archive-adapter.ts`

- [ ] **Step 1: Write the adapter**

```typescript
// packages/storage-adapter/src/local/local-archive-adapter.ts

import type { AFDStorage } from '@agent-fs/storage';
import type {
  DocumentArchiveAdapter,
  ArchiveContent,
  ArchiveReadRequest,
} from '../types.js';

export class LocalArchiveAdapter implements DocumentArchiveAdapter {
  constructor(private readonly storage: AFDStorage) {}

  async write(fileId: string, content: ArchiveContent): Promise<void> {
    await this.storage.write(fileId, content.files);
  }

  async read(fileId: string, filePath: string): Promise<Buffer> {
    return this.storage.read(fileId, filePath);
  }

  async readText(fileId: string, filePath: string): Promise<string> {
    return this.storage.readText(fileId, filePath);
  }

  async readBatch(requests: ArchiveReadRequest[]): Promise<Buffer[]> {
    return this.storage.readBatch(requests);
  }

  async exists(fileId: string): Promise<boolean> {
    return this.storage.exists(fileId);
  }

  async delete(fileId: string): Promise<void> {
    return this.storage.delete(fileId);
  }
}
```

- [ ] **Step 2: Build and commit**

```bash
pnpm build
git add packages/storage-adapter/src/local/local-archive-adapter.ts
git commit -m "feat(storage-adapter): implement LocalArchiveAdapter wrapping AFDStorage"
```

---

### Task 6: Implement LocalAdapter (combined) + Exports

**Files:**
- Create: `packages/storage-adapter/src/local/index.ts`
- Modify: `packages/storage-adapter/src/index.ts`

- [ ] **Step 1: Write LocalAdapter factory**

```typescript
// packages/storage-adapter/src/local/index.ts

import type { VectorStore, InvertedIndex } from '@agent-fs/search';
import type { AFDStorage } from '@agent-fs/storage';
import type { StorageAdapter } from '../types.js';
import { LocalVectorStoreAdapter } from './local-vector-store-adapter.js';
import { LocalInvertedIndexAdapter } from './local-inverted-index-adapter.js';
import { LocalArchiveAdapter } from './local-archive-adapter.js';

export interface LocalAdapterOptions {
  vectorStore: VectorStore;
  invertedIndex: InvertedIndex;
  afdStorage: AFDStorage;
}

export function createLocalAdapter(options: LocalAdapterOptions): StorageAdapter {
  return {
    vector: new LocalVectorStoreAdapter(options.vectorStore),
    invertedIndex: new LocalInvertedIndexAdapter(options.invertedIndex),
    archive: new LocalArchiveAdapter(options.afdStorage),
    metadata: null as any, // Phase 2: LocalMetadataAdapter reads .fs_index/index.json
  };
}

export { LocalVectorStoreAdapter } from './local-vector-store-adapter.js';
export { LocalInvertedIndexAdapter } from './local-inverted-index-adapter.js';
export { LocalArchiveAdapter } from './local-archive-adapter.js';
```

- [ ] **Step 2: Update index.ts to re-export local adapter**

```typescript
// packages/storage-adapter/src/index.ts

export type {
  VectorStoreAdapter,
  VectorSearchParams,
  InvertedIndexAdapter,
  InvertedSearchParams,
  InvertedSearchResult,
  IndexEntry,
  DocumentArchiveAdapter,
  ArchiveContent,
  ArchiveReadRequest,
  MetadataAdapter,
  StorageAdapter,
} from './types.js';

export { createLocalAdapter } from './local/index.js';
export type { LocalAdapterOptions } from './local/index.js';
export { LocalVectorStoreAdapter } from './local/local-vector-store-adapter.js';
export { LocalInvertedIndexAdapter } from './local/local-inverted-index-adapter.js';
export { LocalArchiveAdapter } from './local/local-archive-adapter.js';
```

- [ ] **Step 3: Build and verify full package compiles**

```bash
cd /Users/weidwonder/projects/agent_fs/packages/storage-adapter && pnpm build
```

Expected: Clean build with all types and local implementations.

- [ ] **Step 4: Commit**

```bash
git add packages/storage-adapter/src/
git commit -m "feat(storage-adapter): add LocalAdapter factory combining vector, inverted index, archive adapters"
```

---

### Task 7: Integration Test

**Files:**
- Create: `packages/storage-adapter/src/__tests__/local-adapter.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// packages/storage-adapter/src/__tests__/local-adapter.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLocalAdapter } from '../local/index.js';
import { VectorStore, InvertedIndex } from '@agent-fs/search';
import { createAFDStorage } from '@agent-fs/storage';
import type { VectorDocument } from '@agent-fs/core';

describe('LocalAdapter integration', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'adapter-test-'));
  let adapter: ReturnType<typeof createLocalAdapter>;

  const mockVectorDoc: VectorDocument = {
    chunk_id: 'file1:0',
    file_id: 'file1',
    dir_id: 'dir1',
    rel_path: 'test.md',
    file_path: join(tempDir, 'test.md'),
    chunk_line_start: 1,
    chunk_line_end: 10,
    content_vector: new Array(384).fill(0.1),
    locator: 'line:1-10',
    indexed_at: new Date().toISOString(),
    deleted_at: '',
  };

  beforeAll(async () => {
    const vectorStore = new VectorStore({
      storagePath: join(tempDir, 'vectors'),
      dimension: 384,
    });

    const invertedIndex = new InvertedIndex({
      dbPath: join(tempDir, 'inverted.db'),
    });

    const afdStorage = createAFDStorage({
      documentsDir: join(tempDir, 'documents'),
    });

    adapter = createLocalAdapter({ vectorStore, invertedIndex, afdStorage });
    await adapter.vector.init();
    await adapter.invertedIndex.init();
  });

  afterAll(async () => {
    await adapter.vector.close();
    await adapter.invertedIndex.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('vector: add + search + delete', async () => {
    await adapter.vector.addDocuments([mockVectorDoc]);

    const results = await adapter.vector.searchByVector({
      vector: new Array(384).fill(0.1),
      dirIds: ['dir1'],
      topK: 5,
      mode: 'postfilter',
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk_id).toBe('file1:0');

    await adapter.vector.deleteByFileId('file1');
    const after = await adapter.vector.getByChunkIds(['file1:0']);
    expect(after.length).toBe(0);
  });

  it('inverted index: add + search + remove', async () => {
    await adapter.invertedIndex.addFile('file1', 'dir1', [
      { text: '测试文档内容', chunkId: 'file1:0', locator: 'line:1' },
    ]);

    const results = await adapter.invertedIndex.search({
      query: '测试文档',
      dirIds: ['dir1'],
      topK: 5,
    });
    expect(results.length).toBeGreaterThan(0);

    await adapter.invertedIndex.removeFile('file1');
    const after = await adapter.invertedIndex.search({
      query: '测试文档',
      dirIds: ['dir1'],
    });
    expect(after.length).toBe(0);
  });

  it('archive: write + read + delete', async () => {
    await adapter.archive.write('file1', {
      files: {
        'content.md': '# Hello World',
        'metadata.json': '{"type":"test"}',
      },
    });

    expect(await adapter.archive.exists('file1')).toBe(true);
    const text = await adapter.archive.readText('file1', 'content.md');
    expect(text).toBe('# Hello World');

    await adapter.archive.delete('file1');
    expect(await adapter.archive.exists('file1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd /Users/weidwonder/projects/agent_fs/packages/storage-adapter && pnpm test
```

Expected: All 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/storage-adapter/src/__tests__/
git commit -m "test(storage-adapter): add LocalAdapter integration tests for vector, inverted, archive"
```

---

---

### Task 8: Implement LocalMetadataAdapter

**Files:**
- Create: `packages/storage-adapter/src/local/local-metadata-adapter.ts`

**Context:** Wraps the existing filesystem-based metadata operations: reading/writing `.fs_index/index.json`, reading `~/.agent_fs/registry.json`, and accessing `.fs_index/memory/`.

- [ ] **Step 1: Write LocalMetadataAdapter**

```typescript
// packages/storage-adapter/src/local/local-metadata-adapter.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IndexMetadata } from '@agent-fs/core';
import type { MetadataAdapter } from '../types.js';

export interface LocalMetadataOptions {
  /** 全局 registry 路径，默认 ~/.agent_fs/registry.json */
  registryPath: string;
  /** 获取目录对应的 .fs_index 路径 */
  resolveIndexDir: (dirId: string) => string;
}

export class LocalMetadataAdapter implements MetadataAdapter {
  constructor(private readonly options: LocalMetadataOptions) {}

  async readIndexMetadata(dirId: string): Promise<IndexMetadata | null> {
    const indexPath = join(this.options.resolveIndexDir(dirId), 'index.json');
    if (!existsSync(indexPath)) return null;
    return JSON.parse(readFileSync(indexPath, 'utf-8'));
  }

  async writeIndexMetadata(dirId: string, metadata: IndexMetadata): Promise<void> {
    const indexDir = this.options.resolveIndexDir(dirId);
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'index.json'), JSON.stringify(metadata, null, 2));
  }

  async deleteIndexMetadata(dirId: string): Promise<void> {
    const indexPath = join(this.options.resolveIndexDir(dirId), 'index.json');
    if (existsSync(indexPath)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(indexPath);
    }
  }

  async listSubdirectories(dirId: string): Promise<{ dirId: string; relativePath: string; summary?: string }[]> {
    const metadata = await this.readIndexMetadata(dirId);
    if (!metadata?.subdirectories) return [];
    return metadata.subdirectories.map((sub: any) => ({
      dirId: sub.dirId,
      relativePath: sub.relativePath,
      summary: sub.summary,
    }));
  }

  async listProjects(): Promise<{ projectId: string; name: string; rootDirId: string; summary?: string }[]> {
    if (!existsSync(this.options.registryPath)) return [];
    const registry = JSON.parse(readFileSync(this.options.registryPath, 'utf-8'));
    return (registry.projects || []).map((p: any) => ({
      projectId: p.projectId,
      name: p.name || p.path,
      rootDirId: p.projectId, // root dir uses projectId
      summary: p.summary,
    }));
  }

  async readProjectMemory(projectId: string): Promise<{ memoryPath: string; projectMd: string; files: { name: string; size: number }[] } | null> {
    const indexDir = this.options.resolveIndexDir(projectId);
    const memoryPath = join(indexDir, 'memory');
    if (!existsSync(memoryPath)) return null;

    const projectMdPath = join(memoryPath, 'project.md');
    const projectMd = existsSync(projectMdPath) ? readFileSync(projectMdPath, 'utf-8') : '';

    const files: { name: string; size: number }[] = [];
    const scanDir = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push({ name: entry.name, size: statSync(join(dir, entry.name)).size });
        } else if (entry.isDirectory()) {
          scanDir(join(dir, entry.name));
        }
      }
    };
    scanDir(memoryPath);

    return { memoryPath, projectMd, files };
  }

  async writeProjectMemoryFile(projectId: string, fileName: string, content: string): Promise<void> {
    const indexDir = this.options.resolveIndexDir(projectId);
    const memoryPath = join(indexDir, 'memory');
    mkdirSync(memoryPath, { recursive: true });
    writeFileSync(join(memoryPath, fileName), content);
  }
}
```

- [ ] **Step 2: Update LocalAdapter factory to include metadata**

In `packages/storage-adapter/src/local/index.ts`, replace `metadata: null as any` with:

```typescript
import { LocalMetadataAdapter, type LocalMetadataOptions } from './local-metadata-adapter.js';

export interface LocalAdapterOptions {
  vectorStore: VectorStore;
  invertedIndex: InvertedIndex;
  afdStorage: AFDStorage;
  metadata: LocalMetadataOptions;
}

export function createLocalAdapter(options: LocalAdapterOptions): StorageAdapter {
  const vector = new LocalVectorStoreAdapter(options.vectorStore);
  const invertedIndex = new LocalInvertedIndexAdapter(options.invertedIndex);
  const archive = new LocalArchiveAdapter(options.afdStorage);
  const metadata = new LocalMetadataAdapter(options.metadata);
  return {
    vector, invertedIndex, archive, metadata,
    async init() { await vector.init(); await invertedIndex.init(); },
    async close() { await vector.close(); await invertedIndex.close(); },
  };
}
```

- [ ] **Step 3: Build, test, commit**

```bash
pnpm --filter @agent-fs/storage-adapter build
pnpm --filter @agent-fs/storage-adapter test
git add packages/storage-adapter/
git commit -m "feat(storage-adapter): implement LocalMetadataAdapter for index.json/registry/memory"
```

---

## Phase 1 Success Criteria

- [ ] `@agent-fs/storage-adapter` package compiles cleanly
- [ ] All adapter interfaces defined: `VectorStoreAdapter`, `InvertedIndexAdapter`, `DocumentArchiveAdapter`, `MetadataAdapter`, `StorageAdapter`
- [ ] `LocalAdapter` wraps all 4 backends (vector, inverted, archive, metadata) — no `null as any`
- [ ] `StorageAdapter` has unified `init()` / `close()` lifecycle
- [ ] Conformance tests pass for LocalAdapter
- [ ] No changes to existing packages yet (non-breaking)
