# Agent FS Storage Architecture Exploration Report

**Date:** 2026-03-30  
**Scope:** Storage system imports, usage patterns, and API surface  
**Thoroughness:** Comprehensive (all 3 storage systems analyzed)

---

## Executive Summary

The Agent FS system uses **three distinct storage layers**:

1. **VectorStore** (LanceDB wrapper) - Dense vector embeddings for semantic search
2. **InvertedIndex** (SQLite wrapper) - BM25-based lexical search index
3. **AFDStorage** (Native module) - Document archive storage for markdown, metadata, summaries

These are orchestrated primarily through the **IndexPipeline** during indexing and the **SearchFusion** layer during retrieval.

---

## 1. VectorStore (LanceDB Wrapper)

**Location:** `/Users/weidwonder/projects/agent_fs/packages/search/src/vector-store/store.ts`

### Class Definition

```typescript
export class VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private options: Required<VectorStoreOptions>;

  constructor(options: VectorStoreOptions);
  async init(): Promise<void>;
  // ... public methods
}
```

### VectorStoreOptions Interface

```typescript
export interface VectorStoreOptions {
  storagePath: string;      // Storage directory
  dimension: number;         // Vector dimension
  tableName?: string;        // Default: 'chunks'
}
```

### Core Public Methods

**Write Operations:**
- `async addDocuments(docs: VectorDocument[]): Promise<void>`
  - Batch insert vector embeddings
  
**Read Operations:**
- `async searchByContent(vector: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]>`
  - Semantic search by embedding with optional dir/file filters
  
- `async getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]>`
  - Fetch full documents by chunk IDs

**Delete Operations:**
- `async softDelete(chunkIds: string[]): Promise<void>`
  - Soft-delete by setting deleted_at timestamp
  
- `async deleteByFileId(fileId: string): Promise<void>`
  - Hard-delete all chunks from a file
  
- `async deleteByDirId(dirId: string): Promise<void>`
  - Hard-delete all chunks in a directory
  
- `async deleteByDirIds(dirIds: string[]): Promise<void>`
  - Hard-delete chunks across multiple directories

**Maintenance:**
- `async updateFilePaths(dirId: string, oldPrefix: string, newPrefix: string): Promise<void>`
  - Update paths after move/rename (read-modify-write pattern)
  
- `async compact(): Promise<number>`
  - Remove soft-deleted rows; returns deletion count
  
- `async countRows(): Promise<number>`
  - Get total row count
  
- `async close(): Promise<void>`
  - Close database connection

### VectorSearchOptions Interface

```typescript
export interface VectorSearchOptions {
  topK?: number;                          // Default: 10
  dirId?: string;                         // Single directory filter
  dirIds?: string[];                      // Multiple directories (OR)
  filePathPrefix?: string;                // File path prefix match
  includeDeleted?: boolean;               // Include soft-deleted records
  distanceType?: 'l2' | 'cosine' | 'dot'; // Default: 'cosine'
  minResultsBeforeFallback?: number;      // Postfilter threshold
}
```

### LanceDB Schema

**Required Fields:**
```typescript
const REQUIRED_SCHEMA_FIELDS = new Set([
  'chunk_id',          // Chunk identifier
  'file_id',           // File identifier
  'dir_id',            // Directory identifier
  'rel_path',          // Relative path
  'file_path',         // Absolute path
  'chunk_line_start',  // Line number (1-based)
  'chunk_line_end',    // Line number (1-based)
  'content_vector',    // The embedding vector
  'locator',           // Location reference
  'indexed_at',        // Indexing timestamp
  'deleted_at',        // Soft-delete marker (empty = active)
]);

const ESSENTIAL_SCALAR_INDEX_COLUMNS = ['dir_id', 'chunk_id'];
```

### Factory Function

```typescript
export function createVectorStore(options: VectorStoreOptions): VectorStore {
  return new VectorStore(options);
}
```

### Key Characteristics

- **Initialization:** Validates schema on init; drops/recreates table if schema mismatch detected
- **Postfilter Strategy:** Attempts postfilter first; falls back to prefilter if results < threshold
- **Vector Handling:** Robust normalization supporting Array, ArrayBuffer, custom iterables
- **Distance Conversion:**
  - Cosine: `1 - distance/2` (distance ∈ [0,2])
  - L2: `1 / (1 + distance)`
  - Dot: Returns distance directly

---

## 2. InvertedIndex (SQLite Wrapper)

**Location:** `/Users/weidwonder/projects/agent_fs/packages/search/src/inverted-index/inverted-index.ts`

### Class Definition

```typescript
export class InvertedIndex {
  private readonly db: Database.Database;
  private closed = false;

  constructor(private readonly options: InvertedIndexOptions);
  async init(): Promise<void>;
  // ... public methods
}
```

### InvertedIndexOptions Interface

```typescript
export interface InvertedIndexOptions {
  dbPath: string;
}
```

### Core Public Methods

**Write Operations:**
- `async addFile(fileId: string, dirId: string, entries: IndexEntry[]): Promise<void>`
  - Index a file with BM25 postings; updates scope statistics

**Delete Operations:**
- `async removeFile(fileId: string): Promise<void>`
  - Delete all index entries for a file; updates stats
  
- `async removeDirectory(dirId: string): Promise<void>`
  - Delete entries in a single directory
  
- `async removeDirectories(dirIds: string[]): Promise<void>`
  - Delete entries across multiple directories

**Read Operations:**
- `async search(query: string, options?: InvertedSearchOptions): Promise<InvertedSearchResult[]>`
  - BM25 search with optional directory filtering

**Lifecycle:**
- `async close(): Promise<void>`
  - Close database connection

### Core Data Interfaces

**IndexEntry** (Input):
```typescript
export interface IndexEntry {
  text: string;     // Text to tokenize
  chunkId: string;  // Chunk identifier
  locator: string;  // Location info
}
```

**InvertedSearchOptions:**
```typescript
export interface InvertedSearchOptions {
  dirIds?: string[];
  topK?: number;    // Default: 10
}
```

**InvertedSearchResult** (Output):
```typescript
export interface InvertedSearchResult {
  chunkId: string;
  fileId: string;
  dirId: string;
  locator: string;
  score: number;    // BM25 score
}
```

### SQLite Schema

**Table: `file_terms`**
```sql
CREATE TABLE file_terms (
  term TEXT NOT NULL,
  file_id TEXT NOT NULL,
  dir_id TEXT NOT NULL,
  postings BLOB NOT NULL,           -- MessagePack-encoded Posting[]
  tf_sum INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  doc_length INTEGER NOT NULL,
  PRIMARY KEY (term, file_id)
);

CREATE INDEX idx_term_dir ON file_terms(term, dir_id, tf_sum DESC);
CREATE INDEX idx_dir ON file_terms(dir_id);
CREATE INDEX idx_file ON file_terms(file_id);
```

**Table: `index_stats`**
```sql
CREATE TABLE index_stats (
  dir_id TEXT PRIMARY KEY,
  total_docs INTEGER NOT NULL,
  avg_doc_length REAL NOT NULL
);
```

### Key Characteristics

- **Tokenization:** Uses nodejieba (Chinese word segmentation)
- **Posting Storage:** MessagePack-encoded for efficiency
  ```typescript
  interface Posting {
    chunk_id: string;
    locator: string;
    tf: number;           // Term frequency
    positions: number[];  // Token positions
  }
  ```
- **Concurrency:** SQLite WAL mode enabled for concurrent readers
- **Scope-Aware:** Maintains per-directory BM25 statistics for proper normalization

---

## 3. AFDStorage (Native Module Wrapper)

**Location:** `/Users/weidwonder/projects/agent_fs/packages/storage/src/index.ts`

### Class Definition

```typescript
export class AFDStorage {
  private inner: InstanceType<typeof native.AfdStorage>;

  constructor(options: StorageOptions);
  // ... public methods
}
```

### StorageOptions Interface

```typescript
export interface StorageOptions {
  documentsDir: string;
  cacheSize?: number;
}
```

### Core Public Methods

**Write:**
- `write(fileId: string, files: Record<string, string | Buffer>): Promise<void>`
  - Write multi-file archive atomically

**Read:**
- `read(fileId: string, filePath: string): Promise<Buffer>`
  - Read file as binary Buffer
  
- `readText(fileId: string, filePath: string): Promise<string>`
  - Read file as UTF-8 string

**Batch Read:**
- `readBatch(requests: ReadRequest[]): Promise<Buffer[]>`
  - Batch read multiple files efficiently

**Checks:**
- `exists(fileId: string): Promise<boolean>`
  - Check if archive exists

**Delete:**
- `delete(fileId: string): Promise<void>`
  - Delete entire archive

### ReadRequest Interface

```typescript
export interface ReadRequest {
  fileId: string;
  filePath: string;
}
```

### Typical Archive Structure

```
{fileId}/
  ├── content.md           # Converted markdown content
  ├── metadata.json        # Original file metadata
  └── summaries.json       # {"documentSummary": "..."}
```

### Native Module Binding

The TypeScript wrapper delegates to a native Rust module:

```typescript
const native = require('../storage.node') as {
  AfdStorage: new (documentsDir: string, cacheSize?: number) => {
    write(fileId: string, files: Record<string, string | Buffer>): Promise<void>;
    read(fileId: string, filePath: string): Promise<Buffer>;
    readText(fileId: string, filePath: string): Promise<string>;
    readBatch(requests: { fileId: string; filePath: string }[]): Promise<Buffer[]>;
    exists(fileId: string): Promise<boolean>;
    delete(fileId: string): Promise<void>;
  };
};
```

### Factory Function

```typescript
export function createAFDStorage(options: StorageOptions): AFDStorage {
  return new AFDStorage(options);
}
```

---

## 4. Search Package Public API

**Location:** `/Users/weidwonder/projects/agent_fs/packages/search/src/index.ts`

```typescript
// VectorStore
export { VectorStore, createVectorStore } from './vector-store';
export type { VectorStoreOptions, VectorSearchOptions } from './vector-store';

// InvertedIndex
export * from './inverted-index';
// Re-exports: InvertedIndex, InvertedIndexOptions, IndexEntry,
//             InvertedSearchOptions, InvertedSearchResult, 
//             IndexEntryBuilder, tokenizeText, DirectoryResolver, etc.
```

---

## 5. Indexer Usage Patterns

**File:** `/Users/weidwonder/projects/agent_fs/packages/indexer/src/indexer.ts` (lines 70-143)

### Initialization

```typescript
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

### Write Path (IndexPipeline)

```typescript
// 1. Add embeddings
await vectorStore.addDocuments(vectorDocs: VectorDocument[]);

// 2. Add BM25 index
await invertedIndex.addFile(fileId, dirId, indexEntries: IndexEntry[]);

// 3. Write archive
await afdStorage.write(afdName, {
  'content.md': markdown,
  'metadata.json': JSON.stringify(metadata),
  'summaries.json': JSON.stringify({ documentSummary }),
});
```

### Delete Path

**File deletion (pipeline.ts lines 500-505):**
```typescript
await vectorStore.deleteByFileId(fileId);
await invertedIndex.removeFile(fileId);
await afdStorage.delete(archiveName);
```

**Directory deletion (pipeline.ts lines 546-548):**
```typescript
await vectorStore.deleteByDirId(subdirectory.dirId);
await invertedIndex.removeDirectory(subdirectory.dirId);
```

### Cleanup

```typescript
await invertedIndex.close();
await vectorStore.close();
await embeddingService.dispose();
```

---

## 6. Search/Retrieval Patterns

**File:** `/Users/weidwonder/projects/agent_fs/packages/search/src/fusion/search-fusion.ts`

### Query Flow

```typescript
// 1. Semantic search via embeddings
const vectorResults = await vectorStore.searchByContent(queryVector, {
  topK: topK * 2,
  filePathPrefix,
});

// 2. Lexical search via BM25
const bm25Results = bm25Index.search(query, {
  topK: topK * 2,
  filePathPrefix,
});

// 3. Fusion via Reciprocal Rank Fusion (RRF)
const fused = fusionRRF(lists, ...);

// 4. Fetch missing metadata
const docs = await vectorStore.getByChunkIds(missingIds);

// 5. Return aggregated results
return { results, meta };
```

---

## 7. MCP Server Integration

**Files:** 
- `/Users/weidwonder/projects/agent_fs/packages/mcp-server/src/tools/search.ts`
- `/Users/weidwonder/projects/agent_fs/packages/mcp-server/src/tools/get-chunk.ts`

### Storage Initialization

```typescript
let embeddingService: EmbeddingService | null = null;
let vectorStore: VectorStore | null = null;
let invertedIndex: InvertedIndex | null = null;
const afdStorageCache = new Map<string, AFDStorage>();

export async function initSearchService(): Promise<void> {
  const config = loadConfig();
  const storagePath = join(homedir(), '.agent_fs', 'storage');
  
  embeddingService = createEmbeddingService(config.embedding);
  await embeddingService.init();
  
  vectorStore = createVectorStore({
    storagePath: join(storagePath, 'vectors'),
    dimension: embeddingService.getDimension(),
  });
  await vectorStore.init();
  
  invertedIndex = new InvertedIndex({
    dbPath: join(storagePath, 'inverted-index', 'inverted-index.db'),
  });
  await invertedIndex.init();
}
```

### Document Retrieval

```typescript
const docs = await vectorStore.getByChunkIds(idsToLoad);
const docMap = new Map(docs.map((doc) => [doc.chunk_id, doc]));
```

---

## 8. Storage Directory Layout

```
~/.agent_fs/
  ├── storage/
  │   ├── vectors/                    # LanceDB database
  │   │   └── *.lance files           # Vector index files
  │   └── inverted-index/
  │       └── inverted-index.db       # SQLite BM25 index
  │       └── inverted-index.db-wal   # WAL file
  ├── registry.json                   # Project registry

{project-root}/.fs_index/
  ├── index.json                      # IndexMetadata (filesystem)
  ├── documents/                      # AFDStorage archives
  │   ├── {fileId_1}/
  │   │   ├── content.md
  │   │   ├── metadata.json
  │   │   └── summaries.json
  │   └── {fileId_2}/
  │       └── ...
  └── logs/
      └── summary-backfill.latest.jsonl
```

---

## 9. Core Data Structures

### VectorDocument (from @agent-fs/core)

```typescript
export interface VectorDocument {
  chunk_id: string;           // Chunk identifier
  file_id: string;            // File identifier
  dir_id: string;             // Directory identifier
  rel_path: string;           // Relative path
  file_path: string;          // Absolute file path
  chunk_line_start: number;   // 1-based line number
  chunk_line_end: number;     // 1-based line number
  content_vector: number[];   // Embedding vector
  locator: string;            // Location reference
  indexed_at: string;         // ISO 8601 timestamp
  deleted_at: string;         // ISO 8601 timestamp (empty = active)
}
```

### VectorSearchResult

```typescript
export interface VectorSearchResult {
  chunk_id: string;
  score: number;              // Similarity score (0-1)
  document: VectorDocument;
}
```

---

## Key Architectural Insights

1. **Decoupled Storage Layers:**
   - Each layer optimized for different retrieval modality
   - No direct inter-layer dependencies beyond shared identifiers

2. **Consistency Challenges:**
   - No distributed transactions across three layers
   - All-or-nothing operations only at application level
   - Deletion operations must be synchronized manually

3. **Directory-Level Scoping:**
   - Both VectorStore and InvertedIndex support directory-based filtering
   - Enables efficient multi-directory indexing and deletion
   - Necessary for scaling to large codebases

4. **Soft vs Hard Delete:**
   - VectorStore: Soft-delete with timestamp (enables rollback, but requires compaction)
   - InvertedIndex: Hard-delete (no rollback, immediate cleanup)
   - AFDStorage: Hard-delete (archive removal)

5. **Metadata Context:**
   - VectorStore stores file/directory context in every embedding
   - Enables filtering at query time without separate metadata lookups
   - Trade-off: Increased storage per embedding

6. **Tokenization:**
   - InvertedIndex uses nodejieba for Chinese text
   - Binary postings encoded with MessagePack
   - Efficient storage but immutable structure

7. **Local-Only Architecture:**
   - All three layers are file-based (no network)
   - Good foundation for cloud abstraction layer
   - No built-in replication or distribution

---

## Unresolved Questions

1. **Vector Dimension Configuration:** Where is embedding dimension determined?
   - Config file? Hardcoded? Inferred from model?

2. **Archive Versioning:** Does AFDStorage support version history?
   - Only latest version, or versioned snapshots?

3. **LanceDB Performance:** What are insertion/deletion performance characteristics?
   - Especially for directory-scoped operations?

4. **Concurrent Access:** Are there constraints on concurrent reads/writes?
   - Between VectorStore, InvertedIndex, AFDStorage?

5. **Failure Recovery:** How are incomplete indexing operations recovered?
   - Checkpoint/resume mechanism? Manual retry?

6. **Storage Quotas:** Is there a mechanism to limit storage usage?
   - Eviction policy? Cleanup strategy?

7. **Postfilter Fallback Logic:** Why is the fallback threshold configurable?
   - What are typical threshold values in practice?
