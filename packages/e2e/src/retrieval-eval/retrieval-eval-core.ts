export interface ScoredChunk {
  chunkId: string;
  score: number;
}

export interface EvalMetrics {
  queryId: string;
  precisionAtK: number;
  precisionAtReturned: number;
  recallAtK: number;
  mrr: number;
  returnedCount: number;
  hitChunks: string[];
  missedChunks: string[];
}

export function filterScoredChunks(chunks: ScoredChunk[], minScore: number): ScoredChunk[] {
  if (minScore <= 0) {
    return chunks;
  }
  return chunks.filter((item) => item.score >= minScore);
}

export function dedupeScoredChunks(chunks: ScoredChunk[], topK: number, minScore = 0): string[] {
  const filteredChunks = filterScoredChunks(chunks, minScore);
  const scoreByChunk = new Map<string, number>();

  for (const item of filteredChunks) {
    const existedScore = scoreByChunk.get(item.chunkId);
    if (existedScore === undefined || item.score > existedScore) {
      scoreByChunk.set(item.chunkId, item.score);
    }
  }

  return [...scoreByChunk.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, topK)
    .map(([chunkId]) => chunkId);
}

export function computeMetrics(hitIds: string[], expectedChunkIds: string[], topK: number): EvalMetrics {
  const expectedSet = new Set(expectedChunkIds);
  const topResults = hitIds.slice(0, topK);
  const hitChunks = topResults.filter((chunkId) => expectedSet.has(chunkId));

  let mrr = 0;
  for (let index = 0; index < topResults.length; index += 1) {
    if (expectedSet.has(topResults[index])) {
      mrr = 1 / (index + 1);
      break;
    }
  }

  return {
    queryId: '',
    precisionAtK: topK > 0 ? hitChunks.length / topK : 0,
    precisionAtReturned: topResults.length > 0 ? hitChunks.length / topResults.length : 0,
    recallAtK: expectedSet.size > 0 ? hitChunks.length / expectedSet.size : 0,
    mrr,
    returnedCount: topResults.length,
    hitChunks,
    missedChunks: expectedChunkIds.filter((chunkId) => !hitChunks.includes(chunkId)),
  };
}
