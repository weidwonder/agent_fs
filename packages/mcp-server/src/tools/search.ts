import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IndexMetadata, Registry } from '@agent-fs/core';
import { loadConfig } from '@agent-fs/core';
import type { EmbeddingService } from '@agent-fs/llm';
import { createEmbeddingService } from '@agent-fs/llm';
import type { InvertedIndex, InvertedSearchResult, VectorStore } from '@agent-fs/search';
import {
  InvertedIndex as InvertedIndexClass,
  createVectorStore,
  fusionRRF,
  DirectoryResolver,
  type RegistryProject as ResolverProject,
} from '@agent-fs/search';
import { createAFDStorage, type AFDStorage } from '@agent-fs/storage';

interface SearchInput {
  query: string;
  keyword?: string;
  scope: string | string[];
  top_k?: number;
}

interface RuntimeSearchItem {
  chunkId: string;
  fileId: string;
  source: {
    filePath: string;
    locator: string;
  };
}

interface FileLookup {
  dirPath: string;
  filePath: string;
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
let vectorStore: VectorStore | null = null;
let invertedIndex: InvertedIndex | null = null;
const afdStorageCache = new Map<string, AFDStorage>();

export async function initSearchService(): Promise<void> {
  if (embeddingService && vectorStore && invertedIndex) {
    return;
  }

  const config = loadConfig();
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  if (!existsSync(join(storagePath, 'vectors'))) {
    console.error('Warning: Vector storage not found. Search will not work until indexing is done.');
    return;
  }

  embeddingService = createEmbeddingService(config.embedding);
  await embeddingService.init();

  vectorStore = createVectorStore({
    storagePath: join(storagePath, 'vectors'),
    dimension: embeddingService.getDimension(),
  });
  await vectorStore.init();

  invertedIndex = new InvertedIndexClass({
    dbPath: join(storagePath, 'inverted-index', 'inverted-index.db'),
  });
  await invertedIndex.init();
}

export async function disposeSearchService(): Promise<void> {
  if (vectorStore) {
    await vectorStore.close();
    vectorStore = null;
  }

  if (invertedIndex) {
    await invertedIndex.close();
    invertedIndex = null;
  }

  if (embeddingService) {
    await embeddingService.dispose();
    embeddingService = null;
  }

  afdStorageCache.clear();
}

export function getVectorStore(): VectorStore {
  if (!vectorStore) {
    throw new Error('Search service not initialized. No indexes available.');
  }

  return vectorStore;
}

export function __setSearchServicesForTest(services: {
  embeddingService?: EmbeddingService;
  vectorStore?: VectorStore;
  invertedIndex?: InvertedIndex;
}): void {
  if (services.embeddingService) {
    embeddingService = services.embeddingService;
  }
  if (services.vectorStore) {
    vectorStore = services.vectorStore;
  }
  if (services.invertedIndex) {
    invertedIndex = services.invertedIndex;
  }
}

export function __resetSearchServicesForTest(): void {
  embeddingService = null;
  vectorStore = null;
  invertedIndex = null;
  afdStorageCache.clear();
}

export async function search(input: SearchInput) {
  if (!embeddingService || !vectorStore || !invertedIndex) {
    throw new Error('Search service not initialized. Please index some directories first.');
  }

  const startTime = Date.now();
  const topK = input.top_k ?? 10;
  const scopes = normalizeScopes(input.scope);
  const scopedContext = resolveScopedContext(scopes);

  const queryVector = await embeddingService.embed(input.query);

  const contentVectorResults = await searchVector(
    vectorStore,
    queryVector,
    'content',
    topK,
    scopes,
    scopedContext.dirIds
  );

  const summaryVectorResults = await searchVector(
    vectorStore,
    queryVector,
    'summary',
    topK,
    scopes,
    scopedContext.dirIds
  );

  const keywordResults = await invertedIndex.search(input.keyword || input.query, {
    dirIds: scopedContext.dirIds.length > 0 ? scopedContext.dirIds : undefined,
    topK: topK * 3,
  });

  const lists = [
    {
      name: 'content_vector',
      items: contentVectorResults.map((item) => mapVectorItem(item, scopedContext.fileLookup)),
    },
    {
      name: 'summary_vector',
      items: summaryVectorResults.map((item) => mapVectorItem(item, scopedContext.fileLookup)),
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
          (item) => item.chunkId,
          (existing, next) => ({
            chunkId: existing.chunkId,
            fileId: existing.fileId || next.fileId,
            source: {
              filePath: existing.source.filePath || next.source.filePath,
              locator: existing.source.locator || next.source.locator,
            },
          })
        )
      : [];

  const markdownCache = new Map<string, string>();
  const summariesCache = new Map<string, Record<string, string>>();

  const hydratedResults = await Promise.all(
    fused.slice(0, topK).map(async (fusedItem) => {
      const hydrated = await hydrateResult(
        fusedItem.item,
        scopedContext.fileLookup,
        markdownCache,
        summariesCache
      );
      return {
        chunk_id: hydrated.chunkId,
        score: fusedItem.score,
        content: hydrated.content,
        summary: hydrated.summary,
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
  store: VectorStore,
  queryVector: number[],
  type: 'content' | 'summary',
  topK: number,
  scopes: string[],
  dirIds: string[]
) {
  const merged = new Map<string, { chunk_id: string; score: number; document: Record<string, unknown> }>();

  const requests =
    dirIds.length > 0
      ? dirIds.map((dirId) => ({ dirId }))
      : scopes.length > 0
        ? scopes.map((scope) => ({ filePathPrefix: scope }))
        : [{}];

  for (const request of requests) {
    const results =
      type === 'content'
        ? await store.searchByContent(queryVector, { ...request, topK: topK * 3 })
        : await store.searchBySummary(queryVector, { ...request, topK: topK * 3 });

    for (const result of results) {
      const existing = merged.get(result.chunk_id);
      if (!existing || existing.score < result.score) {
        merged.set(result.chunk_id, {
          chunk_id: result.chunk_id,
          score: result.score,
          document: result.document as unknown as Record<string, unknown>,
        });
      }
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

async function hydrateResult(
  item: RuntimeSearchItem,
  fileLookup: Map<string, FileLookup>,
  markdownCache: Map<string, string>,
  summariesCache: Map<string, Record<string, string>>
): Promise<RuntimeSearchItem & { content: string; summary: string }> {
  const fileInfo = fileLookup.get(item.fileId);
  if (!fileInfo) {
    return {
      ...item,
      content: '',
      summary: '',
    };
  }

  const storage = getAfdStorage(fileInfo.dirPath);
  const markdown = await readMarkdown(storage, item.fileId, markdownCache);
  const summaries = await readSummaries(storage, item.fileId, summariesCache);

  const parsedContent = extractByLocator(markdown, item.source.locator);

  return {
    ...item,
    source: {
      filePath: fileInfo.filePath,
      locator: item.source.locator,
    },
    content: parsedContent,
    summary: summaries[item.chunkId] ?? '',
  };
}

function getAfdStorage(dirPath: string): AFDStorage {
  const key = normalizePath(dirPath);
  const cached = afdStorageCache.get(key);
  if (cached) {
    return cached;
  }

  const storage = createAFDStorage({
    documentsDir: join(dirPath, '.fs_index', 'documents'),
  });
  afdStorageCache.set(key, storage);
  return storage;
}

async function readMarkdown(
  storage: AFDStorage,
  fileId: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(fileId);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const value = await storage.readText(fileId, 'content.md');
    cache.set(fileId, value);
    return value;
  } catch {
    cache.set(fileId, '');
    return '';
  }
}

async function readSummaries(
  storage: AFDStorage,
  fileId: string,
  cache: Map<string, Record<string, string>>
): Promise<Record<string, string>> {
  const cached = cache.get(fileId);
  if (cached) {
    return cached;
  }

  try {
    const buffer = await storage.read(fileId, 'summaries.json');
    const parsed = JSON.parse(buffer.toString('utf-8')) as Record<string, string>;
    cache.set(fileId, parsed);
    return parsed;
  } catch {
    const empty: Record<string, string> = {};
    cache.set(fileId, empty);
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
