import type { Clue, ClueSummary, IndexMetadata, VectorDocument } from '@agent-fs/core';

export type { VectorDocument, IndexMetadata };

// ---------------------------------------------------------------------------
// VectorStore
// ---------------------------------------------------------------------------

export interface VectorSearchParams {
  vector: number[];
  dirIds: string[];
  topK: number;
  /** Local impl uses postfilter/prefilter strategy; cloud impl may ignore */
  mode?: 'prefilter' | 'postfilter';
  minResultsBeforeFallback?: number;
}

export interface VectorSearchResult {
  chunkId: string;
  score: number;
  document: VectorDocument;
}

export interface VectorStoreAdapter {
  init(): Promise<void>;
  addDocuments(docs: VectorDocument[]): Promise<void>;
  searchByVector(params: VectorSearchParams): Promise<VectorSearchResult[]>;
  getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]>;
  deleteByFileId(fileId: string): Promise<void>;
  deleteByDirId(dirId: string): Promise<void>;
  deleteByDirIds(dirIds: string[]): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// InvertedIndex
// ---------------------------------------------------------------------------

export interface InvertedIndexEntry {
  text: string;
  chunkId: string;
  locator: string;
}

export interface InvertedSearchResult {
  chunkId: string;
  fileId: string;
  dirId: string;
  score: number;
  locator: string;
}

export interface InvertedIndexAdapter {
  init(): Promise<void>;
  addFile(
    fileId: string,
    dirId: string,
    entries: InvertedIndexEntry[],
  ): Promise<void>;
  search(params: {
    terms: string[];
    dirIds: string[];
    topK: number;
  }): Promise<InvertedSearchResult[]>;
  removeFile(fileId: string): Promise<void>;
  removeDirectory(dirId: string): Promise<void>;
  removeDirectories(dirIds: string[]): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// DocumentArchive
// ---------------------------------------------------------------------------

export interface DocumentArchiveAdapter {
  write(
    fileId: string,
    content: { files: Record<string, string> },
  ): Promise<void>;
  read(fileId: string, fileName: string): Promise<string>;
  readBatch(
    fileId: string,
    fileNames: string[],
  ): Promise<Record<string, string>>;
  exists(fileId: string): Promise<boolean>;
  delete(fileId: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface MetadataAdapter {
  readIndexMetadata(dirId: string): Promise<IndexMetadata | null>;
  writeIndexMetadata(dirId: string, metadata: IndexMetadata): Promise<void>;
  deleteIndexMetadata(dirId: string): Promise<void>;
  listSubdirectories(
    dirId: string,
  ): Promise<{ dirId: string; relativePath: string; summary?: string }[]>;
  listProjects(): Promise<
    {
      projectId: string;
      name: string;
      rootDirId: string;
      summary?: string;
    }[]
  >;
  readProjectMemory(projectId: string): Promise<{
    memoryPath: string;
    projectMd: string;
    files: { name: string; size: number }[];
  } | null>;
  writeProjectMemoryFile(
    projectId: string,
    fileName: string,
    content: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Clue
// ---------------------------------------------------------------------------

export interface ClueAdapter {
  init(): Promise<void>;
  listClues(projectId: string): Promise<ClueSummary[]>;
  getClue(clueId: string): Promise<Clue | null>;
  saveClue(clue: Clue): Promise<void>;
  deleteClue(clueId: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// StorageAdapter (root)
// ---------------------------------------------------------------------------

/**
 * Composite storage adapter.
 *
 * Factory functions only assemble the object — no I/O.
 * Callers must explicitly call `init()` before use and `close()` when done.
 */
export interface StorageAdapter {
  vector: VectorStoreAdapter;
  invertedIndex: InvertedIndexAdapter;
  archive: DocumentArchiveAdapter;
  metadata: MetadataAdapter;
  clue: ClueAdapter;
  init(): Promise<void>;
  close(): Promise<void>;
}
