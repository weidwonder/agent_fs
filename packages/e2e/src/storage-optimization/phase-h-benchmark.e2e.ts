import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { PluginManager } from '../../../indexer/src/plugin-manager';
import { IndexPipeline } from '../../../indexer/src/pipeline';
import { createAFDStorage } from '../../../storage/src';
import { createVectorStore, InvertedIndex, fusionRRF } from '../../../search/src';

interface BenchmarkContext {
  homeDir: string;
  projectDir: string;
  storageDir: string;
  pluginManager: PluginManager;
  embeddingService: {
    embed: ReturnType<typeof vi.fn>;
  };
  summaryService: {
    generateDocumentSummary: ReturnType<typeof vi.fn>;
    generateDirectorySummary: ReturnType<typeof vi.fn>;
  };
  vectorStore: ReturnType<typeof createVectorStore>;
  invertedIndex: InvertedIndex;
  afdStorage: ReturnType<typeof createAFDStorage>;
}

interface DatasetSnapshot {
  files: string[];
  fileCount: number;
}

interface MutationSnapshot {
  modifiedCount: number;
  addedCount: number;
  deletedCount: number;
}

interface MetricSummary {
  rounds: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
}

interface BenchmarkReport {
  dataset: {
    initialFileCount: number;
    modifiedFiles: number;
    addedFiles: number;
    deletedFiles: number;
    changedFiles: number;
  };
  indexing: {
    fullIndexMs: number;
    incrementalIndexMs: number;
    incrementalPerChangedFileMs: number;
  };
  search: {
    vector: MetricSummary;
    inverted: MetricSummary;
    fusion: MetricSummary;
  };
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function toMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

function createEmbedding(text: string): number[] {
  if (text.includes('向量词A')) {
    return [1, 0, 0, 0, 0, 0, 0, 0];
  }
  if (text.includes('向量词B')) {
    return [0, 1, 0, 0, 0, 0, 0, 0];
  }
  if (text.includes('向量词C')) {
    return [0, 0, 1, 0, 0, 0, 0, 0];
  }

  const vector = Array.from({ length: 8 }, () => 0);
  for (let index = 0; index < text.length; index += 1) {
    vector[index % vector.length] += (text.charCodeAt(index) % 17) / 17;
  }
  return vector;
}

function writeDataset(projectDir: string, totalFiles: number): DatasetSnapshot {
  const relativeDirs = ['', 'docs', 'docs/nested', 'notes'];
  for (const relativeDir of relativeDirs) {
    if (!relativeDir) continue;
    mkdirSync(join(projectDir, relativeDir), { recursive: true });
  }

  const files: string[] = [];
  for (let index = 0; index < totalFiles; index += 1) {
    const relativeDir = relativeDirs[index % relativeDirs.length];
    const relativePath = relativeDir
      ? join(relativeDir, `doc-${String(index).padStart(3, '0')}.md`)
      : `doc-${String(index).padStart(3, '0')}.md`;
    const absolutePath = join(projectDir, relativePath);
    const vectorTerm = index % 3 === 0 ? '向量词A' : index % 3 === 1 ? '向量词B' : '向量词C';
    const keywordTerm = index % 2 === 0 ? '倒排词A' : '倒排词B';
    const content = [
      `# 基准文档 ${index}`,
      '',
      `本文用于性能测试，包含 ${vectorTerm} 与 ${keywordTerm}。`,
      '',
      `段落一：${vectorTerm} 在检索中用于向量召回。`,
      '',
      `段落二：${keywordTerm} 在检索中用于倒排召回。`,
      '',
      `段落三：文档序号 ${index}。`,
    ].join('\n');
    writeFileSync(absolutePath, content);
    files.push(relativePath);
  }

  return {
    files,
    fileCount: files.length,
  };
}

function applyMutations(projectDir: string, files: string[]): MutationSnapshot {
  const modified = files.slice(0, 8);
  const deleted = files.slice(8, 14);

  for (const relativePath of modified) {
    writeFileSync(
      join(projectDir, relativePath),
      `# 增量修改\n\n向量词A 与 倒排词A。\n\n该文档被修改以触发增量重建。`
    );
  }

  for (const relativePath of deleted) {
    rmSync(join(projectDir, relativePath), { force: true });
  }

  const addedBase = join(projectDir, 'docs', 'nested');
  const addedCount = 6;
  for (let index = 0; index < addedCount; index += 1) {
    writeFileSync(
      join(addedBase, `added-${String(index).padStart(2, '0')}.md`),
      `# 增量新增 ${index}\n\n向量词A 与 倒排词A。\n\n新增内容用于增量测试。`
    );
  }

  return {
    modifiedCount: modified.length,
    addedCount,
    deletedCount: deleted.length,
  };
}

async function measureOnce<T>(action: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const started = process.hrtime.bigint();
  const result = await action();
  const ended = process.hrtime.bigint();
  return {
    result,
    durationMs: roundMs(toMs(ended - started)),
  };
}

function summarizeDurations(durations: number[]): MetricSummary {
  const sorted = [...durations].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);

  return {
    rounds: sorted.length,
    avgMs: roundMs(total / sorted.length),
    minMs: roundMs(sorted[0]),
    maxMs: roundMs(sorted[sorted.length - 1]),
    p95Ms: roundMs(sorted[p95Index]),
  };
}

async function measureRounds(rounds: number, action: () => Promise<void>): Promise<MetricSummary> {
  const durations: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const started = process.hrtime.bigint();
    await action();
    const ended = process.hrtime.bigint();
    durations.push(toMs(ended - started));
  }
  return summarizeDurations(durations);
}

function printReport(report: BenchmarkReport): void {
  console.info('[Phase H.5][Benchmark]', JSON.stringify(report, null, 2));
}

function createPipeline(context: BenchmarkContext): IndexPipeline {
  return new IndexPipeline({
    dirPath: context.projectDir,
    pluginManager: context.pluginManager,
    embeddingService: context.embeddingService as any,
    summaryService: context.summaryService as any,
    vectorStore: context.vectorStore,
    invertedIndex: context.invertedIndex,
    afdStorage: context.afdStorage,
    chunkOptions: { minTokens: 1, maxTokens: 200 },
    summaryOptions: {
      mode: 'skip',
    },
  });
}

async function createContext(): Promise<BenchmarkContext> {
  const homeDir = createTempDir('agent-fs-h5-home-');
  const projectDir = createTempDir('agent-fs-h5-project-');
  const storageDir = join(homeDir, '.agent_fs', 'storage');
  mkdirSync(storageDir, { recursive: true });

  const pluginManager = new PluginManager();
  pluginManager.register(new MarkdownPlugin());

  const embeddingService = {
    embed: vi.fn(async (text: string) => createEmbedding(text)),
  };
  const summaryService = {
    generateDocumentSummary: vi.fn(async () => ({ summary: '' })),
    generateDirectorySummary: vi.fn(async () => ({ summary: '' })),
  };

  const vectorStore = createVectorStore({
    storagePath: join(storageDir, 'vectors'),
    dimension: 8,
  });
  await vectorStore.init();

  const invertedIndex = new InvertedIndex({
    dbPath: join(storageDir, 'inverted-index', 'inverted-index.db'),
  });
  await invertedIndex.init();

  const afdStorage = createAFDStorage({
    documentsDir: join(projectDir, '.fs_index', 'documents'),
  });

  return {
    homeDir,
    projectDir,
    storageDir,
    pluginManager,
    embeddingService,
    summaryService,
    vectorStore,
    invertedIndex,
    afdStorage,
  };
}

async function disposeContext(context: BenchmarkContext): Promise<void> {
  await context.invertedIndex.close();
  await context.vectorStore.close();
  rmSync(context.projectDir, { recursive: true, force: true });
  rmSync(context.homeDir, { recursive: true, force: true });
}

describe('Phase H.5: 性能基准 E2E', () => {
  let context: BenchmarkContext;

  beforeEach(async () => {
    context = await createContext();
  });

  afterEach(async () => {
    await disposeContext(context);
  });

  it('H.5 性能基准：完整索引/增量更新/搜索耗时统计', async () => {
    const dataset = writeDataset(context.projectDir, 96);

    const firstRun = await measureOnce(async () => createPipeline(context).run());
    expect(firstRun.result.stats.fileCount).toBe(dataset.fileCount);

    const mutation = applyMutations(context.projectDir, dataset.files);
    const secondRun = await measureOnce(async () => createPipeline(context).run());
    expect(secondRun.result.stats.fileCount).toBe(
      dataset.fileCount - mutation.deletedCount + mutation.addedCount
    );

    const queryVector = await context.embeddingService.embed('向量词A');
    const vectorSummary = await measureRounds(20, async () => {
      const results = await context.vectorStore.searchByContent(queryVector, { topK: 20 });
      if (results.length === 0) {
        throw new Error('向量搜索结果为空');
      }
    });

    const invertedSummary = await measureRounds(20, async () => {
      const results = await context.invertedIndex.search('倒排词A', { topK: 20 });
      if (results.length === 0) {
        throw new Error('倒排搜索结果为空');
      }
    });

    const fusionVectorInput = await context.vectorStore.searchByContent(queryVector, { topK: 20 });
    const fusionKeywordInput = await context.invertedIndex.search('倒排词A', { topK: 20 });
    const fusionSummary = await measureRounds(40, async () => {
      const fused = fusionRRF(
        [
          {
            name: 'vector',
            items: fusionVectorInput.map((item) => ({
              chunkId: item.chunk_id,
              filePath: String((item.document as any).file_path),
            })),
          },
          {
            name: 'inverted',
            items: fusionKeywordInput.map((item) => ({
              chunkId: item.chunkId,
              fileId: item.fileId,
              filePath: '',
            })),
          },
        ],
        (item) => item.chunkId,
        (existing, next) => ({ ...existing, ...next })
      );
      if (fused.length === 0) {
        throw new Error('融合搜索结果为空');
      }
    });

    const changedFiles = mutation.modifiedCount + mutation.addedCount + mutation.deletedCount;
    const report: BenchmarkReport = {
      dataset: {
        initialFileCount: dataset.fileCount,
        modifiedFiles: mutation.modifiedCount,
        addedFiles: mutation.addedCount,
        deletedFiles: mutation.deletedCount,
        changedFiles,
      },
      indexing: {
        fullIndexMs: firstRun.durationMs,
        incrementalIndexMs: secondRun.durationMs,
        incrementalPerChangedFileMs: roundMs(secondRun.durationMs / changedFiles),
      },
      search: {
        vector: vectorSummary,
        inverted: invertedSummary,
        fusion: fusionSummary,
      },
    };

    printReport(report);

    expect(report.indexing.fullIndexMs).toBeGreaterThan(0);
    expect(report.indexing.incrementalIndexMs).toBeGreaterThan(0);
    expect(report.indexing.incrementalPerChangedFileMs).toBeGreaterThan(0);
    expect(report.search.vector.avgMs).toBeGreaterThan(0);
    expect(report.search.inverted.avgMs).toBeGreaterThan(0);
    expect(report.search.fusion.avgMs).toBeGreaterThan(0);
    expect(report.indexing.incrementalPerChangedFileMs).toBeLessThan(1000);
  });
});
