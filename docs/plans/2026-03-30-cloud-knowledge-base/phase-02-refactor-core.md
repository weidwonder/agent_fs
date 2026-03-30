# Phase 2: Refactor Indexer / Search / MCP to Use Adapters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace direct imports of `VectorStore`/`InvertedIndex`/`AFDStorage` in `indexer`, `search`, `mcp-server`, and `electron-app` with `StorageAdapter` interfaces. After this phase, the core logic is backend-agnostic.

**Prerequisite:** Phase 1 complete.

---

## Refactoring Strategy

The key insight: `indexer` and `mcp-server/tools/search.ts` directly instantiate and call `VectorStore`, `InvertedIndex`, `AFDStorage`. We need to:

1. Change `IndexerOptions` to accept `StorageAdapter` instead of three separate backends
2. Change MCP search initialization to accept `StorageAdapter`
3. Change `SearchFusion` to accept adapter interfaces instead of concrete classes
4. Update Electron IPC to construct `LocalAdapter` and pass it through
5. Update MCP server to construct `LocalAdapter` at startup

**No behavior changes.** All existing tests must continue to pass.

---

### Task 1: Update `@agent-fs/indexer` to accept `StorageAdapter`

**Files:**
- Modify: `packages/indexer/src/pipeline.ts`
- Modify: `packages/indexer/src/indexer.ts` (if it exists as a wrapper)

- [ ] **Step 1: Add `@agent-fs/storage-adapter` dependency to indexer**

In `packages/indexer/package.json`, add:
```json
"dependencies": {
  "@agent-fs/storage-adapter": "workspace:*",
  ...existing
}
```

Run `pnpm install`.

- [ ] **Step 2: Update `IndexerOptions` type**

In `packages/indexer/src/pipeline.ts`, replace the three separate storage imports:

```typescript
// BEFORE:
import type { IndexEntry, InvertedIndex, VectorStore } from '@agent-fs/search';
import type { AFDStorage } from '@agent-fs/storage';

export interface IndexerOptions {
  // ...
  vectorStore: VectorStore;
  invertedIndex: InvertedIndex;
  afdStorage: AFDStorage;
  afdStorageResolver?: (dirPath: string) => AFDStorage;
  // ...
}

// AFTER:
import type { StorageAdapter, DocumentArchiveAdapter, IndexEntry } from '@agent-fs/storage-adapter';

export interface IndexerOptions {
  // ...
  storage: StorageAdapter;
  archiveResolver?: (dirPath: string) => DocumentArchiveAdapter;
  // ...
}
```

- [ ] **Step 3: Update all internal usages in pipeline.ts**

Replace all occurrences:
- `this.options.vectorStore.addDocuments(...)` → `this.options.storage.vector.addDocuments(...)`
- `this.options.invertedIndex.addFile(...)` → `this.options.storage.invertedIndex.addFile(...)`
- `this.options.afdStorage.write(fileId, files)` → `this.options.storage.archive.write(fileId, { files })`
- `this.options.afdStorage.readText(...)` → `this.options.storage.archive.readText(...)`
- `this.options.afdStorage.exists(...)` → `this.options.storage.archive.exists(...)`
- `this.options.afdStorage.delete(...)` → `this.options.storage.archive.delete(...)`
- `this.options.afdStorageResolver?.(dirPath)` → `this.options.archiveResolver?.(dirPath)`
- `this.options.vectorStore.deleteByFileId(...)` → `this.options.storage.vector.deleteByFileId(...)`
- `this.options.invertedIndex.removeFile(...)` → `this.options.storage.invertedIndex.removeFile(...)`

For `afdStorage.write()`, the existing call is `afdStorage.write(fileId, filesRecord)`. The adapter expects `archive.write(fileId, { files: filesRecord })`. Update every call site.

- [ ] **Step 4: Build indexer**

```bash
cd /Users/weidwonder/projects/agent_fs && pnpm --filter @agent-fs/indexer build
```

Fix any remaining type errors until clean.

- [ ] **Step 5: Run indexer tests**

```bash
pnpm --filter @agent-fs/indexer test
```

Update test files to construct `StorageAdapter` via `createLocalAdapter()` instead of passing three separate objects.

- [ ] **Step 6: Commit**

```bash
git add packages/indexer/
git commit -m "refactor(indexer): accept StorageAdapter instead of direct storage backends"
```

---

### Task 2: Update `@agent-fs/search` exports — add adapter-compatible re-exports

**Files:**
- Modify: `packages/search/src/index.ts`

**Context:** The `SearchFusion` class currently imports concrete `VectorStore` and `BM25Index`. For Phase 2, we keep `SearchFusion` working with concrete types internally but ensure MCP/Electron can pass adapter-wrapped objects. The key change: MCP search tool will use adapter interfaces directly instead of `SearchFusion`.

- [ ] **Step 1: Ensure `@agent-fs/search` re-exports its types cleanly**

Verify `packages/search/src/index.ts` exports:
- `VectorStore`, `VectorStoreOptions`, `VectorSearchOptions`
- `InvertedIndex`, `InvertedIndexOptions`, `IndexEntry`, `InvertedSearchOptions`
- `SearchFusion`, `createSearchFusion`

No changes needed if already exported. Just verify.

- [ ] **Step 2: Commit** (if any changes)

---

### Task 3: Update MCP Server search tool to use `StorageAdapter`

**Files:**
- Modify: `packages/mcp-server/src/tools/search.ts`
- Modify: `packages/mcp-server/src/server.ts`

**Context:** `search.ts` is 1130 lines — it directly creates `VectorStore`, `InvertedIndex`, `EmbeddingService` and does its own RRF fusion. We need to:
1. Accept a `StorageAdapter` from outside instead of creating backends internally
2. Replace `vectorStore.searchByContent()` with `storage.vector.searchByVector()`
3. Replace `invertedIndex.search()` with `storage.invertedIndex.search()`

- [ ] **Step 1: Add dependency**

In `packages/mcp-server/package.json`:
```json
"dependencies": {
  "@agent-fs/storage-adapter": "workspace:*",
  ...existing
}
```

- [ ] **Step 2: Refactor `initSearchService()` in search.ts**

```typescript
// BEFORE:
let vectorStore: VectorStore | null = null;
let invertedIndex: InvertedIndex | null = null;

export async function initSearchService() {
  vectorStore = new VectorStore({ storagePath: ..., dimension: ... });
  await vectorStore.init();
  invertedIndex = new InvertedIndex({ dbPath: ... });
  await invertedIndex.init();
  embeddingService = ...;
}

// AFTER:
import type { StorageAdapter } from '@agent-fs/storage-adapter';
import { createLocalAdapter } from '@agent-fs/storage-adapter';

let storageAdapter: StorageAdapter | null = null;

export async function initSearchService() {
  const vectorStore = new VectorStore({ storagePath: ..., dimension: ... });
  const invertedIndex = new InvertedIndex({ dbPath: ... });
  const afdStorage = createAFDStorage({ documentsDir: ... });

  storageAdapter = createLocalAdapter({ vectorStore, invertedIndex, afdStorage });
  await storageAdapter.vector.init();
  await storageAdapter.invertedIndex.init();
  embeddingService = ...;
}

// Also support injecting adapter externally (for cloud server):
export function setStorageAdapter(adapter: StorageAdapter) {
  storageAdapter = adapter;
}
```

- [ ] **Step 3: Update search() function to use adapter**

Replace all direct `vectorStore.` and `invertedIndex.` calls with `storageAdapter.vector.` and `storageAdapter.invertedIndex.` calls.

Key replacements in the search function:
- `vectorStore.searchByContent(queryVector, opts)` → `storageAdapter.vector.searchByVector({ vector: queryVector, dirIds, topK, mode: 'postfilter' })`
- `invertedIndex.search(keyword, { dirIds, topK })` → `storageAdapter.invertedIndex.search({ query: keyword, dirIds, topK })`
- `vectorStore.getByChunkIds(ids)` → `storageAdapter.vector.getByChunkIds(ids)`

- [ ] **Step 4: Update get-chunk.ts to use adapter for AFD reads**

Replace direct `AFDStorage` usage with `storageAdapter.archive.readText()`.

- [ ] **Step 5: Build and test MCP server**

```bash
pnpm --filter @agent-fs/mcp-server build
pnpm --filter @agent-fs/mcp-server test
```

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/
git commit -m "refactor(mcp-server): use StorageAdapter instead of direct VectorStore/InvertedIndex/AFD"
```

---

### Task 4: Update Electron App to construct LocalAdapter

**Files:**
- Modify: `packages/electron-app/src/main/index.ts`

- [ ] **Step 1: Add dependency**

`packages/electron-app/package.json`:
```json
"@agent-fs/storage-adapter": "workspace:*"
```

- [ ] **Step 2: Refactor Electron IPC init to use LocalAdapter**

In `index.ts`, wherever `VectorStore`, `InvertedIndex`, `AFDStorage` are created, wrap them in `createLocalAdapter()` and pass the adapter to indexer/search.

```typescript
import { createLocalAdapter } from '@agent-fs/storage-adapter';

// During app init:
const adapter = createLocalAdapter({ vectorStore, invertedIndex, afdStorage });
```

Then pass `adapter` to:
- Indexer construction (`storage: adapter`)
- Search operations (via `setStorageAdapter(adapter)` or direct use)
- IPC handlers that read AFD (`adapter.archive.readText(...)`)

- [ ] **Step 3: Build and test Electron**

```bash
pnpm --filter @agent-fs/electron-app build
```

Verify the app still starts and can search/index.

- [ ] **Step 4: Commit**

```bash
git add packages/electron-app/
git commit -m "refactor(electron): construct LocalAdapter and pass to indexer/search"
```

---

### Task 5: Verify end-to-end

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/weidwonder/projects/agent_fs && pnpm test
```

All existing tests must pass. Fix any breakages.

- [ ] **Step 2: Manual smoke test**

1. Start Electron app, verify indexing works
2. Start MCP server, verify search works

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve adapter migration issues across packages"
```

---

## Phase 2 Success Criteria

- [ ] `indexer` accepts `StorageAdapter` — no direct LanceDB/SQLite/AFD imports
- [ ] `mcp-server` search uses `StorageAdapter` — supports `setStorageAdapter()` injection
- [ ] `electron-app` constructs `LocalAdapter` and passes it through
- [ ] All existing tests pass unchanged (behavior preserved)
- [ ] `SearchFusion` still works (may still use concrete types internally; full adapter migration is optional)
