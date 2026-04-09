import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IndexMetadata, Registry } from '@agent-fs/core';
import { loadConfig } from '@agent-fs/core';
import type { EmbeddingService } from '@agent-fs/llm';
import { createEmbeddingService } from '@agent-fs/llm';
import type { InvertedSearchResult } from '@agent-fs/search';
import {
  fusionRRF,
  aggregateTopByFile,
  DirectoryResolver,
  type RegistryProject as ResolverProject,
} from '@agent-fs/search';
import type { StorageAdapter } from '@agent-fs/storage-adapter';
import { createLocalAdapter } from '@agent-fs/storage-adapter';
import { resolveDisplayLocator } from './locator-display.js';

interface SearchInput {
  query: string;
  keyword?: string;
  scope: string | string[];
  top_k?: number;
}

interface RuntimeSearchItem {
  chunkId: string;
  fileId: string;
  chunkLineStart?: number;
  chunkLineEnd?: number;
  source: {
    filePath: string;
    locator: string;
  };
}

interface KeywordSnippet {
  chunk_id: string;
  locator: string;
  text: string;
}

interface AggregatedSearchResult {
  item: RuntimeSearchItem;
  score: number;
  chunkHits: number;
  chunkIds: string[];
}

interface FileLookup {
  dirPath: string;
  filePath: string;
  afdName: string;
}

interface RuntimeProject {
  path: string;
  alias: string;
  projectId: string;
  summary: string;
  lastUpdated: string;
  totalFileCount: number;
  totalChunkCount: number;
  subdirectories: Array<{
    relativePath: string;
    dirId: string;
    fileCount: number;
    chunkCount: number;
    lastUpdated: string;
  }>;
  valid: boolean;
}

let embeddingService: EmbeddingService | null = null;
let storageAdapter: StorageAdapter | null = null;
let initPromise: Promise<void> | null = null;

export function setStorageAdapter(adapter: StorageAdapter): void {
  storageAdapter = adapter;
}

export async function initSearchService(): Promise<void> {
  if (embeddingService && storageAdapter) {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = initializeSearchService();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

async function initializeSearchService(): Promise<void> {
  if (embeddingService && storageAdapter) {
    return;
  }

  if (embeddingService || storageAdapter) {
    await closeCurrentSearchServices();
  }

  const config = loadConfig();
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  if (!existsSync(join(storagePath, 'vectors'))) {
    console.error('Warning: Vector storage not found. Search will not work until indexing is done.');
    return;
  }

  const nextEmbeddingService = createEmbeddingService(config.embedding);
  let nextStorageAdapter: StorageAdapter | null = null;

  try {
    await nextEmbeddingService.init();

    nextStorageAdapter = createLocalAdapter({
      storagePath,
      dimension: nextEmbeddingService.getDimension(),
    });
    await nextStorageAdapter.init();

    embeddingService = nextEmbeddingService;
    storageAdapter = nextStorageAdapter;
  } catch (error) {
    await closeInitializedSearchServices(nextEmbeddingService, nextStorageAdapter);
    throw error;
  }
}

export async function disposeSearchService(): Promise<void> {
  const pendingInit = initPromise;
  initPromise = null;

  if (pendingInit) {
    try {
      await pendingInit;
    } catch {
      // 初始化失败后继续清理当前资源
    }
  }

  await closeCurrentSearchServices();
}

export function getStorageAdapter(): StorageAdapter {
  if (!storageAdapter) {
    throw new Error('Search service not initialized. No indexes available.');
  }

  return storageAdapter;
}

export function __setSearchServicesForTest(services: {
  embeddingService?: EmbeddingService;
  storageAdapter?: StorageAdapter;
}): void {
  if (services.embeddingService) {
    embeddingService = services.embeddingService;
  }
  if (services.storageAdapter) {
    storageAdapter = services.storageAdapter;
  }
}

export function __resetSearchServicesForTest(): void {
  initPromise = null;
  embeddingService = null;
  storageAdapter = null;
}

async function closeCurrentSearchServices(): Promise<void> {
  const currentStorageAdapter = storageAdapter;
  const currentEmbeddingService = embeddingService;

  storageAdapter = null;
  embeddingService = null;

  await closeInitializedSearchServices(currentEmbeddingService, currentStorageAdapter);
}

async function closeInitializedSearchServices(
  activeEmbeddingService: EmbeddingService | null,
  activeStorageAdapter: StorageAdapter | null,
): Promise<void> {
  const cleanupResults = await Promise.allSettled([
    activeStorageAdapter?.close(),
    activeEmbeddingService?.dispose(),
  ]);

  for (const result of cleanupResults) {
    if (result.status === 'rejected') {
      console.error('搜索服务清理失败:', result.reason);
    }
  }
}

export async function search(input: SearchInput) {
  if (!embeddingService || !storageAdapter) {
    throw new Error('Search service not initialized. Please index some directories first.');
  }

  const startTime = Date.now();
  const topK = input.top_k ?? 10;
  const scopes = normalizeScopes(input.scope);
  const scopedContext = resolveScopedContext(scopes);

  const queryVector = await embeddingService.embed(input.query);

  const hybridVectorResults = await searchVector(
    storageAdapter,
    queryVector,
    topK,
    scopes,
    scopedContext.dirIds
  );

  const keywordText = input.keyword || input.query;
  const keywordResults = await storageAdapter.invertedIndex.search({
    terms: [keywordText],
    dirIds: scopedContext.dirIds,
    topK: topK * 3,
  });

  const lists = [
    {
      name: 'content_vector',
      items: hybridVectorResults.map((item) => mapVectorItem(item, scopedContext.fileLookup)),
    },
    {
      name: 'inverted_index',
      items: keywordResults.map((item) => mapKeywordItem(item, scopedContext.fileLookup)),
    },
  ].filter((list) => list.items.length > 0);

  const fused =
    lists.length > 0
      ? fusionRRF(
          lists,
          (item: RuntimeSearchItem) => item.chunkId,
          (existing: RuntimeSearchItem, next: RuntimeSearchItem) => ({
            chunkId: existing.chunkId,
            fileId: existing.fileId || next.fileId,
            chunkLineStart: existing.chunkLineStart ?? next.chunkLineStart,
            chunkLineEnd: existing.chunkLineEnd ?? next.chunkLineEnd,
            source: {
              filePath: existing.source.filePath || next.source.filePath,
              locator: existing.source.locator || next.source.locator,
            },
          })
        )
      : [];

  const diversified = aggregateTopByFile(
    fused,
    topK,
    (item: RuntimeSearchItem) => item.fileId || item.source.filePath,
    (item: RuntimeSearchItem) => item.chunkId
  ) as AggregatedSearchResult[];

  const markdownCache = new Map<string, string>();
  const summariesCache = new Map<string, { documentSummary: string }>();
  const locatorMappingCache = new Map<string, LocatorMappingItem[]>();
  const keywordSnippetsByFile = await buildKeywordSnippetsByFile(
    input.keyword,
    keywordResults,
    scopedContext.fileLookup,
    new Set(diversified.map((item) => item.item.fileId).filter((fileId) => fileId.length > 0)),
    storageAdapter,
    markdownCache,
    summariesCache,
    locatorMappingCache
  );

  const reselectedResults = await reselectionAggregatedResults(
    diversified,
    fused,
    {
      query: input.query,
      keyword: input.keyword,
    },
    scopedContext.fileLookup,
    storageAdapter,
    keywordSnippetsByFile,
    markdownCache,
    summariesCache,
    locatorMappingCache
  );

  const hydratedResults = await Promise.all(
    reselectedResults.map(async (fusedItem) => {
      const hydrated = await hydrateResult(
        fusedItem.item,
        scopedContext.fileLookup,
        markdownCache,
        summariesCache,
        locatorMappingCache
      );
      return {
        chunk_id: hydrated.chunkId,
        score: fusedItem.score,
        content: hydrated.content,
        summary: hydrated.summary,
        chunk_hits: fusedItem.chunkHits,
        aggregated_chunk_ids: fusedItem.chunkIds,
        keyword_snippets: keywordSnippetsByFile.get(hydrated.fileId),
        source: {
          file_path: hydrated.source.filePath,
          locator: hydrated.source.locator,
        },
      };
    })
  );

  return {
    results: hydratedResults,
    meta: {
      total_searched: lists.reduce((sum, list) => sum + list.items.length, 0),
      fusion_method: 'rrf',
      elapsed_ms: Date.now() - startTime,
    },
  };
}

function normalizeScopes(scope: string | string[]): string[] {
  const values = Array.isArray(scope) ? scope : [scope];
  return values
    .map((item) => normalizePath(item))
    .filter(Boolean);
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/u, '');
}

function resolveScopedContext(scopes: string[]): {
  dirIds: string[];
  fileLookup: Map<string, FileLookup>;
} {
  const fileLookup = new Map<string, FileLookup>();
  const dirIds = new Set<string>();
  const candidates = new Set<string>();

  const registry = loadRegistry();
  const projects = registry?.projects ?? [];

  if (projects.length > 0) {
    const requestedDirIds = collectRequestedDirIds(projects, scopes);
    const resolver = new DirectoryResolver(
      projects.map<ResolverProject>((project) => ({
        projectId: project.projectId,
        subdirectories: project.subdirectories.map((subdirectory) => ({
          dirId: subdirectory.dirId,
          relativePath: subdirectory.relativePath,
        })),
      }))
    );
    const expandedDirIds = resolver.expandDirIds(requestedDirIds);
    for (const dirId of expandedDirIds) {
      dirIds.add(dirId);
    }

    for (const project of projects) {
      if (!project.valid) continue;

      const projectPath = normalizePath(project.path);
      const projectRelated = scopes.some((scope) => isPathRelated(projectPath, scope));
      if (!projectRelated && !expandedDirIds.some((dirId) => hasDirId(project, dirId))) {
        continue;
      }

      if (expandedDirIds.includes(project.projectId)) {
        candidates.add(projectPath);
      }

      for (const subdirectory of project.subdirectories) {
        if (!expandedDirIds.includes(subdirectory.dirId)) continue;
        candidates.add(join(project.path, normalizeRelativePath(subdirectory.relativePath)));
      }
    }
  }

  for (const scope of scopes) {
    const indexPath = join(scope, '.fs_index', 'index.json');
    if (existsSync(indexPath)) {
      candidates.add(scope);
    }
  }

  for (const candidatePath of candidates) {
    const indexMetadata = readIndexMetadata(candidatePath);
    if (!indexMetadata) continue;

    dirIds.add(indexMetadata.dirId);
    for (const file of indexMetadata.files) {
      fileLookup.set(file.fileId, {
        dirPath: candidatePath,
        filePath: join(candidatePath, file.name),
        afdName: file.afdName ?? file.name ?? file.fileId,
      });
    }
  }

  return {
    dirIds: [...dirIds],
    fileLookup,
  };
}

function isPathRelated(pathA: string, pathB: string): boolean {
  return (
    pathA === pathB ||
    pathA.startsWith(`${pathB}/`) ||
    pathB.startsWith(`${pathA}/`)
  );
}

function loadRegistry(): Registry | null {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(registryPath)) {
    return null;
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  if (!Array.isArray(registry.projects)) {
    throw new Error('registry.json 不是 2.0 格式，请删除后重新索引');
  }

  return registry;
}

function collectRequestedDirIds(projects: RuntimeProject[], scopes: string[]): string[] {
  const dirIds = new Set<string>();

  for (const project of projects) {
    if (!project.valid) continue;

    const normalizedProjectPath = normalizePath(project.path);
    for (const scope of scopes) {
      if (!isPathRelated(normalizedProjectPath, scope)) {
        continue;
      }

      if (scope === normalizedProjectPath) {
        dirIds.add(project.projectId);
        continue;
      }

      if (scope.startsWith(`${normalizedProjectPath}/`)) {
        const relativePath = normalizeRelativePath(scope.slice(normalizedProjectPath.length + 1));
        const matchedSubdir = project.subdirectories.find(
          (subdirectory) =>
            normalizeRelativePath(subdirectory.relativePath) === relativePath
        );
        if (matchedSubdir) {
          dirIds.add(matchedSubdir.dirId);
        } else {
          dirIds.add(project.projectId);
        }
      }
    }
  }

  return [...dirIds];
}

function normalizeRelativePath(path: string): string {
  return path.replace(/^\/+|\/+$/gu, '');
}

function hasDirId(project: RuntimeProject, dirId: string): boolean {
  return (
    project.projectId === dirId ||
    project.subdirectories.some((subdirectory) => subdirectory.dirId === dirId)
  );
}

function readIndexMetadata(dirPath: string): IndexMetadata | null {
  const indexPath = join(dirPath, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) {
    return null;
  }

  return JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadata;
}

async function searchVector(
  adapter: StorageAdapter,
  queryVector: number[],
  topK: number,
  scopes: string[],
  dirIds: string[]
) {
  const merged = new Map<string, { chunk_id: string; score: number; document: Record<string, unknown> }>();

  const searchDirIds = dirIds.length > 0 ? dirIds : [];

  const results = await adapter.vector.searchByVector({
    vector: queryVector,
    dirIds: searchDirIds,
    topK: topK * 3,
    mode: 'postfilter',
    minResultsBeforeFallback: topK,
  });

  for (const result of results) {
    const existing = merged.get(result.chunkId);
    if (!existing || existing.score < result.score) {
      merged.set(result.chunkId, {
        chunk_id: result.chunkId,
        score: result.score,
        document: result.document as unknown as Record<string, unknown>,
      });
    }
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK * 3);
}

function mapVectorItem(
  item: { chunk_id: string; score: number; document: Record<string, unknown> },
  fileLookup: Map<string, FileLookup>
): RuntimeSearchItem {
  const fileId = String(item.document.file_id ?? '');
  const filePath =
    String(item.document.file_path ?? '') ||
    fileLookup.get(fileId)?.filePath ||
    '';

  return {
    chunkId: item.chunk_id,
    fileId,
    chunkLineStart: toPositiveInt(item.document.chunk_line_start),
    chunkLineEnd: toPositiveInt(item.document.chunk_line_end),
    source: {
      filePath,
      locator: String(item.document.locator ?? ''),
    },
  };
}

function mapKeywordItem(
  item: InvertedSearchResult,
  fileLookup: Map<string, FileLookup>
): RuntimeSearchItem {
  return {
    chunkId: item.chunkId,
    fileId: item.fileId,
    source: {
      filePath: fileLookup.get(item.fileId)?.filePath || '',
      locator: item.locator,
    },
  };
}

async function buildKeywordSnippetsByFile(
  keyword: string | undefined,
  keywordResults: InvertedSearchResult[],
  fileLookup: Map<string, FileLookup>,
  topFileIds: Set<string>,
  adapter: StorageAdapter,
  markdownCache: Map<string, string>,
  summariesCache: Map<string, { documentSummary: string }>,
  locatorMappingCache: Map<string, LocatorMappingItem[]>
): Promise<Map<string, KeywordSnippet[]>> {
  const normalizedKeyword = keyword?.trim();
  if (!normalizedKeyword) {
    return new Map();
  }

  if (topFileIds.size === 0) {
    return new Map();
  }

  const runtimeItems: RuntimeSearchItem[] = [];
  const seenChunkIds = new Set<string>();

  for (const item of keywordResults) {
    if (!topFileIds.has(item.fileId) || seenChunkIds.has(item.chunkId)) {
      continue;
    }

    seenChunkIds.add(item.chunkId);
    runtimeItems.push(mapKeywordItem(item, fileLookup));
  }

  await enrichChunkRangesFromVectorStore(runtimeItems, adapter);

  const snippetsByFile = new Map<string, KeywordSnippet[]>();
  for (const item of runtimeItems) {
    const hydrated = await hydrateResult(
      item,
      fileLookup,
      markdownCache,
      summariesCache,
      locatorMappingCache
    );
    const snippet = createKeywordSnippet(hydrated.content, normalizedKeyword);
    if (!snippet) {
      continue;
    }

    const existing = snippetsByFile.get(hydrated.fileId) ?? [];
    if (existing.length >= 3) {
      continue;
    }

    existing.push({
      chunk_id: hydrated.chunkId,
      locator: hydrated.source.locator,
      text: snippet,
    });
    snippetsByFile.set(hydrated.fileId, existing);
  }

  return snippetsByFile;
}

async function reselectionAggregatedResults(
  aggregatedResults: AggregatedSearchResult[],
  fusedResults: Array<{ item: RuntimeSearchItem; score: number; sources: string[] }>,
  searchTerms: {
    query: string;
    keyword?: string;
  },
  fileLookup: Map<string, FileLookup>,
  adapter: StorageAdapter,
  keywordSnippetsByFile: Map<string, KeywordSnippet[]>,
  markdownCache: Map<string, string>,
  summariesCache: Map<string, { documentSummary: string }>,
  locatorMappingCache: Map<string, LocatorMappingItem[]>
): Promise<AggregatedSearchResult[]> {
  if (aggregatedResults.length === 0) {
    return aggregatedResults;
  }

  const fusedItemByChunkId = new Map(
    fusedResults.map((row) => [row.item.chunkId, row.item] satisfies [string, RuntimeSearchItem])
  );
  const fusedScoreByChunkId = new Map(
    fusedResults.map((row) => [row.item.chunkId, row.score] satisfies [string, number])
  );
  const candidateItems = new Map<string, RuntimeSearchItem>();

  for (const result of aggregatedResults) {
    for (const chunkId of result.chunkIds) {
      const candidate = fusedItemByChunkId.get(chunkId);
      if (candidate) {
        candidateItems.set(chunkId, candidate);
      }
    }
  }

  await enrichChunkRangesFromVectorStore([...candidateItems.values()], adapter);

  const hydratedCache = new Map<
    string,
    Promise<RuntimeSearchItem & { content: string; summary: string }>
  >();

  const reselection = await Promise.all(
    aggregatedResults.map(async (result) => {
      const snippetChunkIds = new Set(
        (keywordSnippetsByFile.get(result.item.fileId) ?? []).map((snippet) => snippet.chunk_id)
      );

      let selectedItem = result.item;
      let bestBonus = computeRepresentativeBonus({
        item: result.item,
        content: '',
        query: searchTerms.query,
        keyword: searchTerms.keyword,
        snippetChunkIds,
      });
      let bestChunkScore = fusedScoreByChunkId.get(result.item.chunkId) ?? 0;

      for (const chunkId of result.chunkIds) {
        const candidate = candidateItems.get(chunkId);
        if (!candidate) {
          continue;
        }

        const hydrated = await getHydratedResultCached(
          candidate,
          fileLookup,
          markdownCache,
          summariesCache,
          locatorMappingCache,
          hydratedCache
        );
        const candidateBonus = computeRepresentativeBonus({
          item: candidate,
          content: hydrated.content,
          query: searchTerms.query,
          keyword: searchTerms.keyword,
          snippetChunkIds,
        });
        const candidateChunkScore = fusedScoreByChunkId.get(chunkId) ?? 0;

        if (
          candidateBonus > bestBonus ||
          (candidateBonus === bestBonus && candidateChunkScore > bestChunkScore)
        ) {
          selectedItem = candidate;
          bestBonus = candidateBonus;
          bestChunkScore = candidateChunkScore;
        }
      }

      return {
        ...result,
        item: selectedItem,
        score: result.score + bestBonus,
      };
    })
  );

  return reselection.sort((a, b) => b.score - a.score);
}

async function getHydratedResultCached(
  item: RuntimeSearchItem,
  fileLookup: Map<string, FileLookup>,
  markdownCache: Map<string, string>,
  summariesCache: Map<string, { documentSummary: string }>,
  locatorMappingCache: Map<string, LocatorMappingItem[]>,
  cache: Map<string, Promise<RuntimeSearchItem & { content: string; summary: string }>>
): Promise<RuntimeSearchItem & { content: string; summary: string }> {
  const cached = cache.get(item.chunkId);
  if (cached) {
    return cached;
  }

  const loading = hydrateResult(
    item,
    fileLookup,
    markdownCache,
    summariesCache,
    locatorMappingCache
  );
  cache.set(item.chunkId, loading);
  return loading;
}

async function hydrateResult(
  item: RuntimeSearchItem,
  fileLookup: Map<string, FileLookup>,
  markdownCache: Map<string, string>,
  summariesCache: Map<string, { documentSummary: string }>,
  locatorMappingCache: Map<string, LocatorMappingItem[]>
): Promise<RuntimeSearchItem & { content: string; summary: string }> {
  const fileInfo = fileLookup.get(item.fileId);
  if (!fileInfo) {
    return {
      ...item,
      content: '',
      summary: '',
    };
  }

  const archiveCacheKey = `${normalizePath(fileInfo.dirPath)}/${fileInfo.afdName}`;
  const markdown = await readMarkdown(fileInfo.afdName, archiveCacheKey, markdownCache);
  const summaries = await readSummaries(fileInfo.afdName, archiveCacheKey, summariesCache);
  const locatorMappings = await readLocatorMappings(
    fileInfo.afdName,
    archiveCacheKey,
    locatorMappingCache
  );

  const parsedByLineRange = extractByLineRange(markdown, item.chunkLineStart, item.chunkLineEnd);
  const parsedByLocator = parsedByLineRange ? '' : extractByLocator(markdown, item.source.locator);
  const parsedContent = parsedByLineRange || parsedByLocator;
  const displayLocator = resolveDisplayLocator({
    filePath: fileInfo.filePath,
    locator: item.source.locator,
    chunkLineStart: item.chunkLineStart,
    chunkLineEnd: item.chunkLineEnd,
    mappings: locatorMappings,
  });

  return {
    ...item,
    source: {
      filePath: fileInfo.filePath,
      locator: displayLocator,
    },
    content: stripPageMarkers(parsedContent),
    summary: summaries.documentSummary,
  };
}

async function enrichChunkRangesFromVectorStore(
  items: RuntimeSearchItem[],
  adapter: StorageAdapter
): Promise<void> {
  const missingChunkIds = Array.from(
    new Set(
      items
        .filter((item) => !hasLineRange(item))
        .map((item) => item.chunkId)
        .filter((chunkId) => chunkId.length > 0)
    )
  );

  if (missingChunkIds.length === 0) {
    return;
  }

  let docs: Array<{ chunk_id?: unknown; chunk_line_start?: unknown; chunk_line_end?: unknown }>;
  try {
    const results = await adapter.vector.getByChunkIds(missingChunkIds);
    docs = results as typeof docs;
  } catch {
    return;
  }

  const lineRangeByChunkId = new Map<string, { start: number; end: number }>();
  for (const doc of docs) {
    const chunkId = String(doc.chunk_id ?? '');
    if (!chunkId) continue;

    const start = toPositiveInt(doc.chunk_line_start);
    const end = toPositiveInt(doc.chunk_line_end);
    if (start === undefined || end === undefined) continue;

    lineRangeByChunkId.set(chunkId, { start, end });
  }

  for (const item of items) {
    if (hasLineRange(item)) continue;

    const lineRange = lineRangeByChunkId.get(item.chunkId);
    if (!lineRange) continue;

    item.chunkLineStart = lineRange.start;
    item.chunkLineEnd = lineRange.end;
  }
}

function hasLineRange(item: RuntimeSearchItem): boolean {
  return (
    typeof item.chunkLineStart === 'number' &&
    typeof item.chunkLineEnd === 'number' &&
    item.chunkLineStart > 0 &&
    item.chunkLineEnd >= item.chunkLineStart
  );
}

async function readMarkdown(
  archiveName: string,
  cacheKey: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (!storageAdapter) {
    cache.set(cacheKey, '');
    return '';
  }

  try {
    const value = await storageAdapter.archive.read(archiveName, 'content.md');
    cache.set(cacheKey, value);
    return value;
  } catch {
    cache.set(cacheKey, '');
    return '';
  }
}

async function readSummaries(
  archiveName: string,
  cacheKey: string,
  cache: Map<string, { documentSummary: string }>
): Promise<{ documentSummary: string }> {
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!storageAdapter) {
    const empty = { documentSummary: '' };
    cache.set(cacheKey, empty);
    return empty;
  }

  try {
    const text = await storageAdapter.archive.read(archiveName, 'summaries.json');
    const parsed = JSON.parse(text) as { documentSummary?: unknown };
    const normalized = {
      documentSummary:
        typeof parsed.documentSummary === 'string' ? parsed.documentSummary : '',
    };
    cache.set(cacheKey, normalized);
    return normalized;
  } catch {
    const empty = { documentSummary: '' };
    cache.set(cacheKey, empty);
    return empty;
  }
}

interface LocatorMappingItem {
  markdownRange: {
    startLine: number;
    endLine: number;
  };
  originalLocator: string;
}

const PAGE_MARKER_LINE_RE = /^\s*<!-- page: \d+ -->\s*$/u;

async function readLocatorMappings(
  archiveName: string,
  cacheKey: string,
  cache: Map<string, LocatorMappingItem[]>
): Promise<LocatorMappingItem[]> {
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!storageAdapter) {
    const empty: LocatorMappingItem[] = [];
    cache.set(cacheKey, empty);
    return empty;
  }

  try {
    const text = await storageAdapter.archive.read(archiveName, 'metadata.json');
    const parsed = JSON.parse(text) as { mapping?: LocatorMappingItem[] };
    const mapping = Array.isArray(parsed.mapping) ? parsed.mapping : [];
    cache.set(cacheKey, mapping);
    return mapping;
  } catch {
    const empty: LocatorMappingItem[] = [];
    cache.set(cacheKey, empty);
    return empty;
  }
}

function extractByLocator(markdown: string, locator: string): string {
  if (!markdown || !locator) {
    return '';
  }

  const rangeMatch = /^(?:line|lines):(\d+)-(\d+)$/u.exec(locator.trim());
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    const lines = markdown.split('\n');
    return lines.slice(Math.max(0, start - 1), Math.min(lines.length, end)).join('\n');
  }

  const singleMatch = /^(?:line|lines):(\d+)$/u.exec(locator.trim());
  if (singleMatch) {
    const line = Number(singleMatch[1]);
    const lines = markdown.split('\n');
    return lines[line - 1] ?? '';
  }

  return '';
}

function extractByLineRange(
  markdown: string,
  lineStart?: number,
  lineEnd?: number
): string {
  if (!markdown || !lineStart || !lineEnd || lineStart <= 0 || lineEnd < lineStart) {
    return '';
  }

  const lines = markdown.split('\n');
  return lines
    .slice(Math.max(0, lineStart - 1), Math.min(lines.length, lineEnd))
    .join('\n');
}

export function stripPageMarkers(content: string): string {
  if (!content) {
    return '';
  }

  const withoutMarkers = content.replace(
    /(^|\n)\s*<!-- page: \d+ -->\s*(\n|$)/gu,
    '$1',
  );

  return withoutMarkers
    .split('\n')
    .filter((line) => !PAGE_MARKER_LINE_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function createKeywordSnippet(content: string, keyword: string, contextChars: number = 24): string {
  const normalizedContent = content.trim();
  const normalizedKeyword = keyword.trim();

  if (!normalizedContent || !normalizedKeyword) {
    return '';
  }

  const matchIndex = findSnippetMatchIndex(normalizedContent, normalizedKeyword);
  if (matchIndex < 0) {
    return normalizedContent.slice(0, Math.min(normalizedContent.length, contextChars * 2));
  }

  const start = Math.max(0, matchIndex - contextChars);
  const end = Math.min(
    normalizedContent.length,
    matchIndex + normalizedKeyword.length + contextChars
  );
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedContent.length ? '...' : '';
  return `${prefix}${normalizedContent.slice(start, end)}${suffix}`;
}

function computeRepresentativeBonus(input: {
  item: RuntimeSearchItem;
  content: string;
  query: string;
  keyword?: string;
  snippetChunkIds: Set<string>;
}): number {
  const content = input.content.trim();
  const headingText = extractHeadingText(content);
  const leadingText = content.slice(0, 200);
  const exactPhrases = [input.keyword?.trim(), input.query.trim()].filter(
    (value): value is string => Boolean(value && value.length >= 2)
  );
  const terms = extractSearchTerms(input.query, input.keyword);

  let bonus = 0;

  if (input.snippetChunkIds.has(input.item.chunkId)) {
    bonus += 0.02;
  }

  for (const phrase of exactPhrases) {
    if (content.includes(phrase)) {
      bonus += 0.008;
    }
    if (leadingText.includes(phrase)) {
      bonus += 0.012;
    }
    if (headingText.includes(phrase)) {
      bonus += 0.016;
    }
  }

  let headingTermHits = 0;
  let leadingTermHits = 0;
  for (const term of terms) {
    if (headingText.includes(term)) {
      headingTermHits += 1;
    }
    if (leadingText.includes(term)) {
      leadingTermHits += 1;
    }
  }

  bonus += Math.min(headingTermHits, 3) * 0.004;
  bonus += Math.min(leadingTermHits, 4) * 0.002;

  if (headingTermHits > 0 && hasStructuredAnchor(headingText)) {
    bonus += 0.006;
  }

  return bonus;
}

function extractHeadingText(content: string): string {
  if (!content) {
    return '';
  }

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines
    .filter((line, index) => index < 4 && (index < 2 || looksLikeHeadingLine(line)))
    .join('\n');
}

function hasStructuredAnchor(text: string): boolean {
  return /(^|\n)(#|第[一二三四五六七八九十百千万0-9]+[章节条款]|[一二三四五六七八九十]+[、.])/u.test(
    text
  );
}

function looksLikeHeadingLine(line: string): boolean {
  return (
    line.startsWith('#') ||
    /^第[一二三四五六七八九十百千万0-9]+[章节条款]/u.test(line) ||
    /^[一二三四五六七八九十]+[、.]/u.test(line)
  );
}

function extractSearchTerms(query: string, keyword?: string): string[] {
  const rawTerms = [...splitSearchTerms(keyword ?? ''), ...splitSearchTerms(query)];
  return [...new Set(rawTerms)].filter((term) => term.length >= 2);
}

function splitSearchTerms(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  const normalized = value
    .replace(/[？?！!]/gu, '')
    .replace(/[（(][^）)]*[）)]/gu, ' ')
    .trim();
  const coarseTerms = normalized
    .split(/[\s,，。；;、/:：]+/u)
    .map((item) => item.trim())
    .filter(Boolean);

  const refinedTerms: string[] = [];
  for (const term of coarseTerms) {
    refinedTerms.push(term);
    if (/[\u4e00-\u9fff]/u.test(term) && term.length >= 4) {
      refinedTerms.push(
        ...term
          .split(/什么|哪些|哪类|哪种|如何|多少|是否|需要|需|应当|包括|满足|开始|采用|有关|相关|责任|内容/u)
          .map((item) => item.trim())
          .filter((item) => item.length >= 2)
      );
    }
  }

  return refinedTerms;
}

function findSnippetMatchIndex(content: string, keyword: string): number {
  const directIndex = content.indexOf(keyword);
  if (directIndex >= 0) {
    return directIndex;
  }

  for (const term of splitKeywordTerms(keyword)) {
    const termIndex = content.indexOf(term);
    if (termIndex >= 0) {
      return termIndex;
    }
  }

  return -1;
}

function splitKeywordTerms(keyword: string): string[] {
  return keyword
    .split(/[\s,，。；;、/]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}
