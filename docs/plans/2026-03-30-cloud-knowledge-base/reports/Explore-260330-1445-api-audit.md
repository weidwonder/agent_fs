# Phase 0 Task 1: Public API Surface Audit Report
## Cloud Knowledge Base Refactor - Type Definitions & Call Sites

**Date:** 2026-03-30  
**Scope:** VectorStore, InvertedIndex, AFDStorage, Metadata/Registry usage patterns  
**Status:** Complete

---

## 1. VectorStore Public API

**File:** `packages/search/src/vector-store/store.ts`

### Constructor & Lifecycle
```typescript
constructor(options: VectorStoreOptions)
async init(): Promise<void>
async close(): Promise<void>
```

### Core CRUD Operations (MUST ADAPT)
```typescript
async addDocuments(docs: VectorDocument[]): Promise<void>
  - Adds vector documents to LanceDB
  - No return value; implicit: creates/updates table if needed
  - Default behavior: auto-creates table schema on first call

async getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]>
  - Retrieves full documents by chunk IDs
  - Filters: only non-deleted (deleted_at = '')
  - Returns normalized VectorDocuments with numeric[] vectors
  - Fallback strategy: uses vectorSearch if query() unavailable

async searchByContent(
  vector: number[],
  options: VectorSearchOptions = {}
): Promise<VectorSearchResult[]>
  - Semantic vector search via embedding
  - Options: topK (default 10), dirIds, dirId, filePathPrefix, 
            includeDeleted, distanceType ('cosine'|'l2'|'dot'), 
            minResultsBeforeFallback
  - Returns top-K results with similarity scores (0-1)
  - Implicit behavior: tries postfilter first, falls back to prefilter if results < threshold
```

### Maintenance & Deletion (LOCAL-ONLY OPERATIONS)
```typescript
async softDelete(chunkIds: string[]): Promise<void>
  - Marks chunks as deleted (sets deleted_at to ISO timestamp)
  - No purge; data still in database

async deleteByDirId(dirId: string): Promise<void>
async deleteByDirIds(dirIds: string[]): Promise<void>
  - Hard-deletes all chunks in directory(ies)
  - Cannot be recovered

async deleteByFileId(fileId: string): Promise<void>
  - Hard-deletes all chunks from specific file

async updateFilePaths(
  dirId: string,
  oldPrefix: string,
  newPrefix: string
): Promise<void>
  - Updates rel_path and file_path for directory moves/renames
  - Limitation: LanceDB lacks UPDATE, so reads all ~10k records, updates in-memory, writes back
  - Used when directories are moved/renamed

async compact(): Promise<number>
  - Purges all soft-deleted records (deleted_at != '')
  - Returns count of deleted records
  - Maintenance operation only

async countRows(): Promise<number>
  - Returns total live + soft-deleted records in table
```

### Private Helpers (Implementation Details)
- `ensureTable()`: Lazy-initializes table
- `createEmptyTable()`: Creates empty schema with required fields
- `ensureScalarIndexes()`: Creates indices on dir_id, chunk_id
- `hasExpectedSchema()`: Validates schema matches REQUIRED_SCHEMA_FIELDS
- `searchByVectorColumn()`: Internal routing for search logic
- `tryPostfilterSearch()`: Attempts postfilter optimization
- `buildFilters()`: Constructs WHERE clauses from options
- `normalizeVectorDocument()`: Normalizes vector format from LanceDB
- `normalizeVector()`, `normalizeNumber()`: Handles ArrayBuffer, Uint8Array, other formats

### Schema/Storage Details
**Required Fields (11):**
- chunk_id, file_id, dir_id, rel_path, file_path
- chunk_line_start, chunk_line_end
- content_vector (number[])
- locator, indexed_at, deleted_at

**Indexed Columns:** dir_id, chunk_id (scalar indices)

---

## 2. InvertedIndex Public API

**File:** `packages/search/src/inverted-index/inverted-index.ts`

### Constructor & Lifecycle
```typescript
constructor(options: InvertedIndexOptions)
async init(): Promise<void>
async close(): Promise<void>
```

### Core CRUD Operations (MUST ADAPT)
```typescript
async addFile(
  fileId: string,
  dirId: string,
  entries: IndexEntry[]
): Promise<void>
  - entries = array of { text, chunkId, locator }
  - Tokenizes text, builds BM25 postings (tf, positions)
  - Implicit: atomically deletes old file terms before inserting
  - Auto-updates stats for affected dirIds
  - Schema: file_terms table with (term, file_id, dir_id, postings BLOB, tf_sum, chunk_count, doc_length)

async removeFile(fileId: string): Promise<void>
async removeDirectory(dirId: string): Promise<void>
async removeDirectories(dirIds: string[]): Promise<void>
  - Deletes all index entries; auto-updates stats

async search(
  query: string,
  options: InvertedSearchOptions = {}
): Promise<InvertedSearchResult[]>
  - Tokenizes query
  - topK default: 10
  - dirIds filter: searches only specified directories (optional)
  - Scope stats: computes avgDocLength per scope for BM25 calculation
  - Returns: chunkId, fileId, dirId, locator, BM25 score
  - Implicit: if topK <= 0 or no query terms, returns []
```

### Maintenance Operations (LOCAL-ONLY)
```typescript
private updateStats(dirId: string): void
  - Recalculates per-directory stats (total_docs, avg_doc_length)
  - Called after file add/remove
  - Schema: index_stats table with (dir_id, total_docs, avg_doc_length)

private getScopeStats(dirIds?: string[]): ScopeStats
  - Gets aggregated stats for scope (all dirs if dirIds omitted)
  - Used internally for BM25 scoring

private getTermRows(term: string, dirIds?: string[]): TermRow[]
  - Internal query helper
```

### Database Schema
**Tables:**
- `file_terms`: (term, file_id, dir_id, postings BLOB, tf_sum, chunk_count, doc_length)
  - Indices: idx_term_dir(term, dir_id, tf_sum DESC), idx_dir(dir_id), idx_file(file_id)
- `index_stats`: (dir_id, total_docs, avg_doc_length)

**WAL Mode:** Enabled

---

## 3. AFDStorage Public API

**File:** `packages/storage/src/index.ts`

### Class Wrapper (JavaScript bindings to native module)
```typescript
constructor(options: StorageOptions)
  - options: { documentsDir: string, cacheSize?: number }
  - Wraps native `new AfdStorage(documentsDir, cacheSize?)`
```

### Core Operations (MUST ADAPT)
```typescript
write(fileId: string, files: Record<string, string | Buffer>): Promise<void>
  - Archives multiple files into AFD archive named fileId
  - files map: { "path/to/file.txt" => Buffer | string }

read(fileId: string, filePath: string): Promise<Buffer>
  - Reads single file from archive as binary

readText(fileId: string, filePath: string): Promise<string>
  - Reads and decodes file as UTF-8 string

readBatch(requests: ReadRequest[]): Promise<Buffer[]>
  - requests: array of { fileId, filePath }
  - Batch read optimization; returns Buffers in same order

exists(fileId: string): Promise<boolean>
  - Checks if archive exists

delete(fileId: string): Promise<void>
  - Deletes entire archive
```

**Note:** Native implementation (Rust/C++) via `storage.node` binding.  
Not directly modifiable; interface is stable JavaScript wrapper.

---

## 4. Type Definitions

### VectorDocument
**Location:** `packages/core/src/types/storage.ts`
```typescript
interface VectorDocument {
  chunk_id: string;
  file_id: string;
  dir_id: string;
  rel_path: string;
  file_path: string;
  chunk_line_start: number;      // 1-based
  chunk_line_end: number;        // 1-based
  content_vector: number[];      // Embedding vector
  locator: string;               // Original location reference
  indexed_at: string;            // ISO 8601
  deleted_at: string;            // "" = not deleted, ISO timestamp = soft-deleted
}

interface VectorSearchResult {
  chunk_id: string;
  score: number;                 // 0-1 similarity
  document: VectorDocument;
}
```

### IndexMetadata
**Location:** `packages/core/src/types/index-meta.ts`

Root metadata structure (one per directory: `.fs_index/index.json`)
```typescript
interface IndexMetadata {
  version: string;                          // e.g. "2.0"
  indexedWithVersion?: string;              // Program version that created index
  createdAt: string;                        // ISO 8601
  updatedAt: string;                        // ISO 8601
  dirId: string;                            // UUID for this directory
  directoryPath: string;                    // Absolute path
  directorySummary: string;                 // Generated AI summary
  projectId: string;                        // UUID of root project
  relativePath: string;                     // "." for root, "docs/api" for subdirs
  parentDirId: string | null;               // null for project root
  stats: IndexStats;                        // { fileCount, chunkCount, totalTokens }
  files: FileMetadata[];                    // All files in this directory
  subdirectories: SubdirectoryInfo[];       // All subdirectories
  unsupportedFiles: string[];               // Files not indexed
}

interface FileMetadata {
  name: string;
  afdName?: string;                         // Archive name (without .afd)
  type: string;                             // MIME type
  size: number;                             // Bytes
  hash: string;                             // File hash
  fileId: string;                           // UUID
  indexedAt: string;                        // ISO 8601
  chunkCount: number;
  summary: string;                          // Generated AI summary
}

interface SubdirectoryInfo {
  name: string;
  dirId: string;
  hasIndex: boolean;
  summary: string | null;
  fileCount: number;                        // Recursive
  lastUpdated: string | null;               // ISO 8601
  fileIds: string[];                        // For incremental cleanup
  fileArchives?: Array<{ fileId: string; afdName: string }>;
}
```

### Registry
**Location:** `packages/core/src/types/index-meta.ts`

Global registry structure (`~/.agent_fs/registry.json`)
```typescript
interface Registry {
  version: string;                          // e.g. "2.0"
  embeddingModel: string;
  embeddingDimension: number;
  projects: RegisteredProject[];
}

interface RegisteredProject {
  path: string;                             // Absolute project path
  alias: string;
  projectId: string;
  summary: string;                          // Directory summary
  lastUpdated: string;                      // ISO 8601
  totalFileCount: number;
  totalChunkCount: number;
  subdirectories: SubdirectoryRef[];        // Flattened list
  valid: boolean;
}

interface SubdirectoryRef {
  relativePath: string;
  dirId: string;
  fileCount: number;
  chunkCount: number;
  lastUpdated: string;                      // ISO 8601
}
```

---

## 5. Metadata/Registry Usage: Call Site Inventory

### IndexMetadata (`.fs_index/index.json`)

**Write Sites:**
1. `packages/indexer/src/pipeline.ts` - `persistMetadataTree()` after indexing each directory
2. `packages/mcp-server/src/tools/dir-tree.test.ts` - Test fixture
3. `packages/electron-app/src/main/search-scope.test.ts` - Test fixture

**Read Sites:**
1. `packages/indexer/src/pipeline.ts` - `loadExistingMetadataMap()` for incremental indexing
2. `packages/indexer/src/indexer.ts` - `loadMetadataTree()`, `collectSubdirectoryRefs()` after indexing
3. `packages/mcp-server/src/tools/search.ts` - Extract dirIds and file lookup
4. `packages/mcp-server/src/tools/dir-tree.ts` - Build directory tree response
5. `packages/electron-app/src/main/index.ts` - `collectMetadataNodes()` for registry/memory
6. `packages/electron-app/src/main/search-scope.ts` - Extract dirIds for search scope

### Registry (`~/.agent_fs/registry.json`)

**Write Sites:**
1. `packages/indexer/src/indexer.ts` - `updateRegistry()` after indexing
2. `packages/electron-app/src/main/index.ts` - IPC handlers (register-project, update-project-summary, remove-project)

**Read Sites:**
1. `packages/indexer/src/indexer.ts` - Merge project data after indexing
2. `packages/electron-app/src/main/index.ts` - Multiple IPC handlers
3. `packages/electron-app/src/main/search-scope.ts` - Filter projects for search scope
4. `packages/mcp-server/src/tools/search.ts` - Via DirectoryResolver
5. `packages/mcp-server/src/tools/get-project-memory.ts` - Lookup projects by name/ID

### `.fs_index/memory/` Directory (Project Memory)

**Structure:**
```
.fs_index/memory/
  project.md           # Auto-initialized if not present
  extend/              # User-created .md files
```

**Write Sites:**
1. `packages/indexer/src/indexer.ts` - `initMemoryIfNeeded()` creates project.md with directory summary
2. `packages/electron-app/src/main/project-memory.ts` - Save user-edited memory files

**Read Sites:**
1. `packages/electron-app/src/main/project-memory.ts` - Read all .md files for IPC handler
2. `packages/mcp-server/src/tools/get-project-memory.ts` - Read all .md files for MCP endpoint

### Resume Snapshot (`pipeline-resume-snapshot.json`)

**Location:** `.fs_index/` directory

**Write Sites:**
1. `packages/indexer/src/pipeline.ts` - `persistResumeSnapshot()` for crash recovery
2. `packages/indexer/src/pipeline.ts` - `clearResumeSnapshot()` on success

**Read Sites:**
1. `packages/indexer/src/pipeline.ts` - `loadResumeSnapshot()` for crash recovery

---

## 6. Cloud Refactor Implications

### "Must Adapt" Operations (Require Explicit Cloud Handling)

| Module | Method | Reason |
|--------|--------|--------|
| VectorStore | addDocuments | Writes to LanceDB → cloud API |
| VectorStore | searchByContent | Reads with filtering → stream results |
| VectorStore | getByChunkIds | Retrieves by IDs → query cloud |
| VectorStore | deleteByDirId(s) | Deletes data → soft delete + compact |
| VectorStore | softDelete | Marks deleted → track via deleted_at |
| VectorStore | compact | Purges deleted → background cleanup |
| InvertedIndex | addFile | Writes terms → batch to cloud |
| InvertedIndex | removeFile | Deletes terms → mark deleted |
| InvertedIndex | search | BM25 scoring → compute in cloud or client |
| AFDStorage | write | Archives files → sync to cloud storage |
| AFDStorage | read/readText | Retrieves files → fetch from cloud storage |
| AFDStorage | delete | Removes archives → delete from cloud |

### "Local-Only" Operations (No Cloud Changes)

| Module | Method | Reason |
|--------|--------|--------|
| VectorStore | countRows | Diagnostic; query current state |
| VectorStore | updateFilePaths | Directory rename; updates live records |
| InvertedIndex | close | Lifecycle |
| VectorStore | init/close | Lifecycle |

### Metadata/Registry Strategy

**File Locations:**
- **IndexMetadata** (per directory): `.fs_index/index.json` → Sync with cloud project metadata
- **Registry** (global): `~/.agent_fs/registry.json` → Global state; cloud sync or local cache
- **Memory** (per project): `.fs_index/memory/*.md` → User content; definitely sync to cloud

**Critical Dependencies (MUST REMAIN STABLE):**
1. **dirId**: Sharding key in VectorStore/InvertedIndex
2. **fileId**: Locates archives in AFDStorage
3. **projectId**: Root dirId
4. **stats**: fileCount, chunkCount, totalTokens; sync after indexing

---

## 7. Unresolved Questions for Planning

1. **Vector persistence**: LanceDB is embedded; migrate to cloud vector DB (Pinecone, Weaviate)?
   - Option A: Re-embed all content after sync
   - Option B: Export vectors + metadata as bulk load
   - Option C: Streaming indexing to cloud during pipeline

2. **BM25 state**: InvertedIndex SQLite stores term postings; cloud text search (Elasticsearch)?
   - Requires recomputing postings from source documents
   - Or export SQLite as cloud indices

3. **AFD archives**: Currently in `.fs_index/documents/`; cloud object storage path?
   - S3, GCS, Azure Blob?
   - Naming: fileId-based or hash-based?

4. **Resume snapshots**: pipeline-resume-snapshot.json; needed in cloud?
   - Probably not; assume indexing idempotent
   - But may need transaction markers for incremental sync

5. **Memory files**: `.fs_index/memory/` is user-writable; real-time sync or batch?
   - Electron app writes locally; sync on save or defer?

6. **Registry caching**: `~/.agent_fs/registry.json` is local state; authoritative or cache?
   - If cache: cloud registry is source
   - If local: periodically sync to cloud

