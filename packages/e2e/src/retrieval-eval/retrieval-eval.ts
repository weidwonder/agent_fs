import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type IndexMetadata } from '@agent-fs/core';
import { createEmbeddingService } from '@agent-fs/llm';
import { createVectorStore, fusionRRF, InvertedIndex, type VectorStore } from '@agent-fs/search';
import { computeMetrics, dedupeScoredChunks, type EvalMetrics, type ScoredChunk } from './retrieval-eval-core';

type QueryType = 'semantic' | 'keyword' | 'hybrid';
type EvalMethod = 'content_vector' | 'summary_vector' | 'inverted_index' | 'rrf_fusion';

interface EvalQuery {
  id: string;
  query: string;
  keyword?: string;
  type: QueryType;
  expectedChunks: string[];
  expectedFiles?: string[];
}

interface EvalDataset {
  description?: string;
  version?: string;
  projectPath: string;
  queries: EvalQuery[];
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
}

function loadDataset(datasetPath: string): EvalDataset {
  const dataset = readJsonFile<EvalDataset>(datasetPath);

  if (!dataset.projectPath || typeof dataset.projectPath !== 'string') {
    throw new Error('评测数据缺少 projectPath');
  }
  if (!Array.isArray(dataset.queries) || dataset.queries.length === 0) {
    throw new Error('评测数据缺少 queries');
  }

  return dataset;
}

function collectDirIds(projectPath: string): string[] {
  const dirIds = new Set<string>();
  const visitedDirs = new Set<string>();

  const visitDirectory = (dirPath: string) => {
    if (visitedDirs.has(dirPath)) {
      return;
    }
    visitedDirs.add(dirPath);

    const indexPath = join(dirPath, '.fs_index', 'index.json');
    if (!existsSync(indexPath)) {
      return;
    }

    const metadata = readJsonFile<IndexMetadata>(indexPath);
    dirIds.add(metadata.dirId);

    for (const subdirectory of metadata.subdirectories) {
      if (!subdirectory.name) {
        continue;
      }
      visitDirectory(join(dirPath, subdirectory.name));
    }
  };

  visitDirectory(projectPath);
  return [...dirIds];
}

async function searchContentVector(
  vectorStore: VectorStore,
  queryVector: number[],
  dirIds: string[],
  topK: number,
  minScore: number
): Promise<string[]> {
  const allResults: ScoredChunk[] = [];

  for (const dirId of dirIds) {
    const results = await vectorStore.searchByContent(queryVector, {
      dirId,
      topK: topK * 3,
    });
    allResults.push(...results.map((item) => ({ chunkId: item.chunk_id, score: item.score })));
  }

  return dedupeScoredChunks(allResults, topK, minScore);
}

async function searchSummaryVector(
  vectorStore: VectorStore,
  queryVector: number[],
  dirIds: string[],
  topK: number,
  minScore: number
): Promise<string[]> {
  const allResults: ScoredChunk[] = [];

  for (const dirId of dirIds) {
    const results = await vectorStore.searchBySummary(queryVector, {
      dirId,
      topK: topK * 3,
    });
    allResults.push(...results.map((item) => ({ chunkId: item.chunk_id, score: item.score })));
  }

  return dedupeScoredChunks(allResults, topK, minScore);
}

async function searchKeyword(
  invertedIndex: InvertedIndex,
  keyword: string,
  dirIds: string[],
  topK: number
): Promise<string[]> {
  const results = await invertedIndex.search(keyword, {
    dirIds,
    topK: topK * 3,
  });

  return dedupeScoredChunks(
    results.map((item) => ({ chunkId: item.chunkId, score: item.score })),
    topK,
    0
  );
}

function printSummary(results: Record<EvalMethod, EvalMetrics[]>, topK: number): void {
  console.log('\n=== Agent FS 召回准确率评测报告 ===\n');

  const methods: EvalMethod[] = ['content_vector', 'summary_vector', 'inverted_index', 'rrf_fusion'];
  for (const method of methods) {
    const metrics = results[method];
    const avgPrecision = metrics.reduce((sum, item) => sum + item.precisionAtK, 0) / metrics.length;
    const avgPrecisionAtReturned = metrics.reduce(
      (sum, item) => sum + item.precisionAtReturned,
      0
    ) / metrics.length;
    const avgRecall = metrics.reduce((sum, item) => sum + item.recallAtK, 0) / metrics.length;
    const avgMrr = metrics.reduce((sum, item) => sum + item.mrr, 0) / metrics.length;
    const avgReturnedCount = metrics.reduce((sum, item) => sum + item.returnedCount, 0) / metrics.length;

    console.log(`[${method}]`);
    console.log(`  Avg Precision@${topK}: ${(avgPrecision * 100).toFixed(1)}%`);
    console.log(`  Avg Precision@Returned: ${(avgPrecisionAtReturned * 100).toFixed(1)}%`);
    console.log(`  Avg Recall@${topK}: ${(avgRecall * 100).toFixed(1)}%`);
    console.log(`  Avg MRR: ${avgMrr.toFixed(3)}`);
    console.log(`  Avg Returned Count: ${avgReturnedCount.toFixed(2)}`);
    console.log();
  }

  const queryIds = results.content_vector.map((item) => item.queryId);
  for (const queryId of queryIds) {
    console.log(`--- Query: ${queryId} ---`);
    for (const method of methods) {
      const metric = results[method].find((item) => item.queryId === queryId);
      if (!metric) {
        continue;
      }

      console.log(
        `  [${method}] P=${(metric.precisionAtK * 100).toFixed(0)}% ` +
          `P@R=${(metric.precisionAtReturned * 100).toFixed(0)}% ` +
          `R=${(metric.recallAtK * 100).toFixed(0)}% ` +
          `MRR=${metric.mrr.toFixed(3)} ` +
          `ret=${metric.returnedCount} ` +
          `missed=${metric.missedChunks.length}`
      );
    }
  }
}

async function evaluate(
  datasetPath: string,
  topK: number,
  minContentScore: number,
  minSummaryScore: number
): Promise<void> {
  const dataset = loadDataset(datasetPath);
  const dirIds = collectDirIds(dataset.projectPath);
  if (dirIds.length === 0) {
    throw new Error(`未找到索引目录: ${dataset.projectPath}`);
  }

  const config = loadConfig();
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  const embeddingService = createEmbeddingService(config.embedding);
  let vectorStore: VectorStore | null = null;
  const invertedIndex = new InvertedIndex({
    dbPath: join(storagePath, 'inverted-index', 'inverted-index.db'),
  });

  const results: Record<EvalMethod, EvalMetrics[]> = {
    content_vector: [],
    summary_vector: [],
    inverted_index: [],
    rrf_fusion: [],
  };

  try {
    await embeddingService.init();
    vectorStore = createVectorStore({
      storagePath: join(storagePath, 'vectors'),
      dimension: embeddingService.getDimension(),
    });
    await vectorStore.init();
    await invertedIndex.init();
    if (!vectorStore) {
      throw new Error('向量存储初始化失败');
    }

    for (const query of dataset.queries) {
      const queryText = query.query.trim();
      const keywordText = query.keyword?.trim() ?? '';
      const queryVector = queryText ? await embeddingService.embed(queryText) : null;

      const contentHits = queryVector
        ? await searchContentVector(vectorStore, queryVector, dirIds, topK, minContentScore)
        : [];
      const summaryHits = queryVector
        ? await searchSummaryVector(vectorStore, queryVector, dirIds, topK, minSummaryScore)
        : [];
      const keywordHits = keywordText || queryText
        ? await searchKeyword(invertedIndex, keywordText || queryText, dirIds, topK)
        : [];

      const rrfInput = [
        { name: 'content', items: contentHits.map((chunkId) => ({ chunkId })) },
        { name: 'summary', items: summaryHits.map((chunkId) => ({ chunkId })) },
        { name: 'keyword', items: keywordHits.map((chunkId) => ({ chunkId })) },
      ].filter((list) => list.items.length > 0);

      const fusedHits = rrfInput.length > 0
        ? fusionRRF(rrfInput, (item) => item.chunkId)
            .slice(0, topK)
            .map((item) => item.item.chunkId)
        : [];

      const contentMetric = computeMetrics(contentHits, query.expectedChunks, topK);
      const summaryMetric = computeMetrics(summaryHits, query.expectedChunks, topK);
      const keywordMetric = computeMetrics(keywordHits, query.expectedChunks, topK);
      const fusedMetric = computeMetrics(fusedHits, query.expectedChunks, topK);

      results.content_vector.push({ ...contentMetric, queryId: query.id });
      results.summary_vector.push({ ...summaryMetric, queryId: query.id });
      results.inverted_index.push({ ...keywordMetric, queryId: query.id });
      results.rrf_fusion.push({ ...fusedMetric, queryId: query.id });
    }
  } finally {
    await invertedIndex.close();
    if (vectorStore) {
      await vectorStore.close();
    }
    await embeddingService.dispose();
  }

  printSummary(results, topK);
}

const datasetPath = process.argv[2];
if (!datasetPath) {
  console.error(
    'Usage: pnpm exec tsx packages/e2e/src/retrieval-eval/retrieval-eval.ts <dataset.json> [topK] [minContentScore] [minSummaryScore]'
  );
  process.exit(1);
}

const topKRaw = process.argv[3] ?? '10';
const topK = Number.parseInt(topKRaw, 10);
if (!Number.isFinite(topK) || topK <= 0) {
  console.error(`topK 非法: ${topKRaw}`);
  process.exit(1);
}

const minContentScoreRaw = process.argv[4] ?? '0';
const minContentScore = Number.parseFloat(minContentScoreRaw);
if (!Number.isFinite(minContentScore) || minContentScore < 0 || minContentScore > 1) {
  console.error(`minContentScore 非法: ${minContentScoreRaw}`);
  process.exit(1);
}

const minSummaryScoreRaw = process.argv[5] ?? minContentScoreRaw;
const minSummaryScore = Number.parseFloat(minSummaryScoreRaw);
if (!Number.isFinite(minSummaryScore) || minSummaryScore < 0 || minSummaryScore > 1) {
  console.error(`minSummaryScore 非法: ${minSummaryScoreRaw}`);
  process.exit(1);
}

evaluate(datasetPath, topK, minContentScore, minSummaryScore).catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
