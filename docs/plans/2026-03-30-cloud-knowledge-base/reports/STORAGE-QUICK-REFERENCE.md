# Agent FS Storage Architecture - Quick Reference

## Three Storage Layers

### 1. VectorStore (LanceDB)
**Location:** `packages/search/src/vector-store/store.ts`

**Key Methods:**
- `addDocuments(docs)` - Batch insert embeddings
- `searchByContent(vector, options)` - Semantic search with filtering
- `getByChunkIds(ids)` - Fetch documents by ID
- `deleteByFileId(id)` / `deleteByDirId(id)` - Delete by scope
- `softDelete(ids)` / `compact()` - Soft-delete pattern

**Schema Fields:** chunk_id, file_id, dir_id, rel_path, file_path, chunk_line_start/end, content_vector, locator, indexed_at, deleted_at

**Factory:** `createVectorStore(options)`

---

### 2. InvertedIndex (SQLite + BM25)
**Location:** `packages/search/src/inverted-index/inverted-index.ts`

**Key Methods:**
- `addFile(fileId, dirId, entries)` - Index file with BM25
- `search(query, options)` - BM25 search with directory filtering
- `removeFile(id)` / `removeDirectory(id)` - Delete by scope
- `close()` - Lifecycle

**Schema Tables:**
- `file_terms` - Term postings (MessagePack-encoded)
- `index_stats` - Per-directory BM25 statistics

**Indexes:** idx_term_dir, idx_dir, idx_file

**Notes:**
- Uses nodejieba for tokenization
- WAL mode enabled
- Hard-delete only (no soft-delete)

---

### 3. AFDStorage (Native Rust Module)
**Location:** `packages/storage/src/index.ts`

**Key Methods:**
- `write(fileId, files)` - Write multi-file archive atomically
- `read(fileId, path)` / `readText(fileId, path)` - Read from archive
- `readBatch(requests)` - Batch read
- `exists(fileId)` / `delete(fileId)` - Checks and deletion

**Typical Archive Structure:**
```
{fileId}/
  ├── content.md           # Markdown
  ├── metadata.json        # File metadata
  └── summaries.json       # {"documentSummary": "..."}
```

**Factory:** `createAFDStorage(options)`

---

## Initialization Sequence

```typescript
// From packages/indexer/src/indexer.ts (lines 70-83)

const vectorStore = createVectorStore({
  storagePath: join(storagePath, 'vectors'),
  dimension: embeddingService.getDimension(),
});
await vectorStore.init();

const invertedIndex = new InvertedIndex({
  dbPath: join(storagePath, 'inverted-index', 'inverted-index.db'),
});
await invertedIndex.init();

const afdStorage = createAFDStorage({
  documentsDir: join(dirPath, '.fs_index', 'documents'),
});
```

---

## Write Path (Indexing)

**From:** `packages/indexer/src/pipeline.ts` line 1144-1147

```typescript
// 1. Add embeddings
await vectorStore.addDocuments(vectorDocs);

// 2. Add BM25 index
await invertedIndex.addFile(fileId, dirId, indexEntries);

// 3. Write archive
await afdStorage.write(afdName, {
  'content.md': markdown,
  'metadata.json': JSON.stringify(metadata),
  'summaries.json': JSON.stringify({ documentSummary }),
});
```

---

## Delete Path

**File deletion** (`pipeline.ts:502-504`):
```typescript
await vectorStore.deleteByFileId(fileId);
await invertedIndex.removeFile(fileId);
await afdStorage.delete(archiveName);
```

**Directory deletion** (`pipeline.ts:546-547`):
```typescript
await vectorStore.deleteByDirId(dirId);
await invertedIndex.removeDirectory(dirId);
```

---

## Read Path (Search)

**From:** `packages/search/src/fusion/search-fusion.ts`

```typescript
// 1. Semantic search
const vectorResults = await vectorStore.searchByContent(queryVector, {
  topK: topK * 2,
  filePathPrefix,
});

// 2. Lexical search
const bm25Results = bm25Index.search(query, { topK: topK * 2, filePathPrefix });

// 3. Fusion + fetch missing metadata
const docs = await vectorStore.getByChunkIds(missingIds);

// 4. Return results
return { results, meta };
```

---

## Storage Locations

```
~/.agent_fs/
  ├── storage/
  │   ├── vectors/              # LanceDB
  │   └── inverted-index/
  │       └── inverted-index.db # SQLite
  └── registry.json

{project}/.fs_index/
  ├── index.json
  ├── documents/                # AFDStorage
  │   └── {fileId}/{content.md, metadata.json, summaries.json}
  └── logs/
```

---

## Core Data Interfaces

**VectorDocument:**
```typescript
{
  chunk_id: string;
  file_id: string;
  dir_id: string;
  rel_path: string;
  file_path: string;
  chunk_line_start: number;
  chunk_line_end: number;
  content_vector: number[];
  locator: string;
  indexed_at: string;
  deleted_at: string;  // Empty = active
}
```

**IndexEntry:**
```typescript
{
  text: string;
  chunkId: string;
  locator: string;
}
```

**InvertedSearchResult:**
```typescript
{
  chunkId: string;
  fileId: string;
  dirId: string;
  locator: string;
  score: number;  // BM25
}
```

---

## Export Points

**From `packages/search/src/index.ts`:**
```typescript
export { VectorStore, createVectorStore } from './vector-store';
export type { VectorStoreOptions, VectorSearchOptions } from './vector-store';
export * from './inverted-index';  // InvertedIndex, IndexEntry, etc.
```

**From `packages/storage/src/index.ts`:**
```typescript
export { AFDStorage, createAFDStorage };
export type { StorageOptions, ReadRequest };
```

---

## Key Characteristics

| Aspect | VectorStore | InvertedIndex | AFDStorage |
|--------|-------------|---------------|-----------|
| Backend | LanceDB (Arrow) | SQLite | Native (Rust) |
| Retrieval | Semantic | Lexical (BM25) | Archive |
| Delete Type | Soft + Hard | Hard only | Hard only |
| Scoping | dir_id, file_path prefix | dir_id | None (per fileId) |
| Indexes | Scalar (dir_id, chunk_id) | Term, dir, file | N/A |
| Concurrency | SQLite WAL-like | SQLite WAL | Native handling |

---

## Critical Integration Points

1. **All three layers must be kept in sync**
   - No distributed transactions
   - Deletion must be coordinated in application code

2. **VectorStore stores metadata context**
   - Enables directory-filtered search without separate lookups
   - Increases storage per embedding

3. **InvertedIndex maintains scope statistics**
   - Per-directory BM25 normalization
   - Updated on every addFile/removeFile

4. **AFDStorage is immutable**
   - No versioning built-in
   - Only latest version per fileId

---

## For Storage Abstraction Layer Refactor

**Clear Boundaries:**
- VectorStore API is well-defined (11 public methods)
- InvertedIndex API is well-defined (7 public methods)
- AFDStorage API is minimal (6 public methods)

**Opportunities:**
- Can implement cloud-native wrappers for each layer independently
- Factory pattern already in place (createVectorStore, createAFDStorage)
- No tight coupling between search package and storage

**Challenges:**
- Consistency across layers requires orchestration
- Soft-delete in VectorStore adds complexity
- Directory-scoped operations may be inefficient in distributed settings
