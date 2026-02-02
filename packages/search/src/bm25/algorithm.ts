/**
 * BM25 参数
 */
export interface BM25Params {
  /** 词频饱和参数，通常 1.2-2.0 */
  k1: number;

  /** 文档长度归一化参数，通常 0.75 */
  b: number;
}

/**
 * 默认 BM25 参数
 */
export const DEFAULT_BM25_PARAMS: BM25Params = {
  k1: 1.5,
  b: 0.75,
};

/**
 * 计算 IDF（逆文档频率）
 * @param docCount 文档总数
 * @param docFreq 包含该词的文档数
 */
export function idf(docCount: number, docFreq: number): number {
  // 使用平滑的 IDF 公式，避免除零
  return Math.log((docCount - docFreq + 0.5) / (docFreq + 0.5) + 1);
}

/**
 * 计算单个词的 BM25 分数
 * @param termFreq 词在文档中的频率
 * @param docLength 文档长度（token 数）
 * @param avgDocLength 平均文档长度
 * @param idfScore IDF 分数
 * @param params BM25 参数
 */
export function bm25TermScore(
  termFreq: number,
  docLength: number,
  avgDocLength: number,
  idfScore: number,
  params: BM25Params = DEFAULT_BM25_PARAMS
): number {
  if (termFreq === 0) return 0;
  const { k1, b } = params;

  // BM25 公式
  const numerator = termFreq * (k1 + 1);
  const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));

  return idfScore * (numerator / denominator);
}

/**
 * 计算查询对文档的 BM25 总分
 * @param queryTerms 查询词列表
 * @param docTermFreq 文档词频映射
 * @param docLength 文档长度
 * @param avgDocLength 平均文档长度
 * @param docFreqs 词的文档频率映射
 * @param docCount 文档总数
 * @param params BM25 参数
 */
export function bm25Score(
  queryTerms: string[],
  docTermFreq: Map<string, number>,
  docLength: number,
  avgDocLength: number,
  docFreqs: Map<string, number>,
  docCount: number,
  params: BM25Params = DEFAULT_BM25_PARAMS
): number {
  let score = 0;

  for (const term of queryTerms) {
    const tf = docTermFreq.get(term) || 0;
    if (tf === 0) continue;

    const df = docFreqs.get(term) || 0;
    const idfScore = idf(docCount, df);

    score += bm25TermScore(tf, docLength, avgDocLength, idfScore, params);
  }

  return score;
}
