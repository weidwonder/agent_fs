import { getNodeJieba } from '../nodejieba-runtime';

/**
 * 停用词列表（常见中英文停用词）
 */
const STOP_WORDS = new Set([
  // 中文停用词
  '的', '了', '是', '在', '我', '有', '和', '就',
  '不', '人', '都', '一', '一个', '上', '也', '很',
  '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '那', '什么', '他', '她',
  // 英文停用词
  'the', 'a', 'an', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall',
  'to', 'of', 'in', 'for', 'on', 'with', 'at',
  'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between',
  'and', 'but', 'or', 'nor', 'so', 'yet',
  'it', 'its', 'this', 'that', 'these', 'those',
]);

/**
 * 分词选项
 */
export interface TokenizeOptions {
  /** 是否过滤停用词 */
  removeStopWords?: boolean;

  /** 是否转小写 */
  lowercase?: boolean;

  /** 最小 token 长度 */
  minLength?: number;
}

/**
 * 对文本进行分词
 */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const { removeStopWords = true, lowercase = true, minLength = 1 } = options;

  // 使用 jieba 分词（搜索模式，粒度更细）
  let tokens = getNodeJieba().cutForSearch(text);

  // 合并连续英文/数字分词，避免被拆成单字母
  const merged: string[] = [];
  let buffer = '';
  const flushBuffer = () => {
    if (buffer) {
      merged.push(buffer);
      buffer = '';
    }
  };

  for (const token of tokens) {
    if (/^[A-Za-z0-9]+$/.test(token)) {
      buffer += token;
      continue;
    }
    flushBuffer();
    merged.push(token);
  }
  flushBuffer();
  tokens = merged;

  // 转小写
  if (lowercase) {
    tokens = tokens.map((token) => token.toLowerCase());
  }

  // 过滤
  tokens = tokens.filter((token) => {
    // 过滤空白
    if (!token.trim()) return false;

    // 过滤过短的 token
    if (token.length < minLength) return false;

    // 过滤停用词
    if (removeStopWords && STOP_WORDS.has(token.toLowerCase())) return false;

    // 过滤纯标点
    if (/^[^\w\u4e00-\u9fa5]+$/.test(token)) return false;

    return true;
  });

  return tokens;
}

/**
 * 计算词频
 */
export function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
}
