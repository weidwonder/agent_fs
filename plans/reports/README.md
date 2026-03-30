# Agent FS Storage Architecture Exploration

**Date:** 2026-03-30  
**Explorer:** Agent (Explore subagent)  
**Status:** Complete

## Documents in this Report

### 1. STORAGE-QUICK-REFERENCE.md
**Purpose:** Quick lookup guide for developers  
**Best for:** Getting oriented fast, understanding APIs, integration points  
**Length:** 273 lines

Contains:
- Three-layer architecture overview
- Method signatures and locations
- Data initialization sequence
- Read/write/delete paths
- Storage locations and directory layout
- Core data interfaces
- Quick comparison table

### 2. Explore-260330-1305-storage-arch.md
**Purpose:** Comprehensive reference documentation  
**Best for:** Planning the abstraction layer, understanding implementation details  
**Length:** 637 lines

Contains:
- Executive summary
- Detailed API documentation for each storage layer
- Database schema and field definitions
- Usage patterns in IndexPipeline and SearchFusion
- Import patterns across packages
- Data flow diagrams
- Storage directory structure
- 7 key architectural insights
- 7 unresolved questions for follow-up

---

## Key Findings

### Three Distinct Storage Layers

1. **VectorStore** (LanceDB)
   - File: `packages/search/src/vector-store/store.ts`
   - Purpose: Dense vector embeddings for semantic search
   - API: 11 public methods (add, search, delete by scope, soft-delete, compact)
   - Schema: 11 required fields including content_vector, dir_id for filtering

2. **InvertedIndex** (SQLite + BM25)
   - File: `packages/search/src/inverted-index/inverted-index.ts`
   - Purpose: Lexical search via term-based BM25 scoring
   - API: 7 public methods (add file, search, remove by scope)
   - Schema: file_terms (MessagePack postings) + index_stats (per-directory normalization)

3. **AFDStorage** (Native Rust Module)
   - File: `packages/storage/src/index.ts`
   - Purpose: Document archive storage (markdown, metadata, summaries)
   - API: 6 public methods (write, read, readBatch, exists, delete)
   - Structure: Per-fileId archives with content.md, metadata.json, summaries.json

### Critical Integration Points

- All three layers must stay synchronized (no distributed transactions)
- Deletion operations must be coordinated in application code
- VectorStore stores metadata context (dir_id, file_path) for filtering
- InvertedIndex maintains per-directory BM25 statistics
- AFDStorage is immutable (no versioning)

### Data Flow Paths

**Indexing:** File → Chunk → Embed/Tokenize → VectorStore + InvertedIndex + AFDStorage

**Search:** Query → Embed → VectorStore.searchByContent() + InvertedIndex.search() → Fuse (RRF) → Return results

**Deletion:** Remove from VectorStore → Remove from InvertedIndex → Delete from AFDStorage

---

## Exact File Locations

### Source Code
- VectorStore: `/Users/weidwonder/projects/agent_fs/packages/search/src/vector-store/store.ts`
- InvertedIndex: `/Users/weidwonder/projects/agent_fs/packages/search/src/inverted-index/inverted-index.ts`
- AFDStorage: `/Users/weidwonder/projects/agent_fs/packages/storage/src/index.ts`
- IndexPipeline: `/Users/weidwonder/projects/agent_fs/packages/indexer/src/pipeline.ts`
- SearchFusion: `/Users/weidwonder/projects/agent_fs/packages/search/src/fusion/search-fusion.ts`

### Type Definitions
- VectorDocument: `/Users/weidwonder/projects/agent_fs/packages/core/src/types/storage.ts`
- Chunk types: `/Users/weidwonder/projects/agent_fs/packages/core/src/types/chunk.ts`
- Search types: `/Users/weidwonder/projects/agent_fs/packages/core/src/types/search.ts`

### Exports
- Search package: `/Users/weidwonder/projects/agent_fs/packages/search/src/index.ts`
- Storage package: `/Users/weidwonder/projects/agent_fs/packages/storage/src/index.ts`

---

## For the Abstraction Layer Refactor

### What's Well-Structured
- Factory pattern already in place (createVectorStore, createAFDStorage)
- Clear API boundaries with minimal coupling
- Each storage layer is independently testable
- No tight coupling between search and storage packages

### What Needs Coordination
- Soft-delete pattern in VectorStore (add complexity to cloud wrapper)
- Directory-scoped operations may not be efficient in distributed settings
- Consistency guarantees must be handled at application level
- Postfilter/prefilter strategy is LanceDB-specific

### Refactoring Strategy
1. Implement cloud storage wrapper for each layer independently
2. Keep the same TypeScript interfaces (VectorStoreOptions, InvertedIndexOptions, StorageOptions)
3. Use factory functions to switch implementations (local vs cloud)
4. Implement orchestration layer for multi-layer consistency

---

## Questions Requiring Follow-Up

1. Vector dimension configuration mechanism
2. Archive versioning support in AFDStorage
3. LanceDB performance characteristics for directory scoping
4. Concurrent read/write constraints
5. Failure recovery and checkpoint/resume logic
6. Storage quota and eviction policies
7. Postfilter fallback threshold tuning

See the full report for details on each question.
