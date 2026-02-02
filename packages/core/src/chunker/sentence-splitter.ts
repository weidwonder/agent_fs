import { countTokens } from './tokenizer';

/**
 * 句子切分选项
 */
export interface SentenceSplitOptions {
  /** 最大 token 数 */
  maxTokens: number;

  /** 重叠比例 */
  overlapRatio?: number;
}

/**
 * 切分后的句子段落
 */
export interface SentenceChunk {
  /** 内容 */
  content: string;

  /** Token 数 */
  tokenCount: number;

  /** 在原文中的起始字符位置 */
  startOffset: number;

  /** 在原文中的结束字符位置 */
  endOffset: number;
}

/**
 * 将文本按句子切分
 * 支持中英文句子
 */
export function splitBySentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    current += char;

    if (/[。！？.!?]/.test(char)) {
      const next = text[i + 1];
      if (char === '.' && next && /\d/.test(next)) {
        continue;
      }

      sentences.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    sentences.push(current.trim());
  }

  return sentences.filter((sentence) => sentence.length > 0);
}

/**
 * 将超大文本块按句子切分成多个小块
 */
export function splitLargeBlock(
  text: string,
  options: SentenceSplitOptions
): SentenceChunk[] {
  const { maxTokens, overlapRatio = 0.1 } = options;
  const sentences = splitBySentences(text);

  if (sentences.length === 0) {
    return [];
  }

  const chunks: SentenceChunk[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  let startOffset = 0;

  for (const sentence of sentences) {
    const sentenceTokens = countTokens(sentence);

    if (sentenceTokens > maxTokens) {
      if (currentChunk.length > 0) {
        const content = currentChunk.join(' ');
        chunks.push({
          content,
          tokenCount: currentTokens,
          startOffset,
          endOffset: startOffset + content.length,
        });
        startOffset += content.length + 1;
      }

      chunks.push({
        content: sentence,
        tokenCount: sentenceTokens,
        startOffset,
        endOffset: startOffset + sentence.length,
      });
      startOffset += sentence.length + 1;

      currentChunk = [];
      currentTokens = 0;
      continue;
    }

    if (currentTokens + sentenceTokens > maxTokens && currentChunk.length > 0) {
      const content = currentChunk.join(' ');
      chunks.push({
        content,
        tokenCount: currentTokens,
        startOffset,
        endOffset: startOffset + content.length,
      });

      const overlapSentences = Math.ceil(currentChunk.length * overlapRatio);
      const overlap = currentChunk.slice(-overlapSentences);
      const overlapTokens = overlap.reduce(
        (sum, sentenceText) => sum + countTokens(sentenceText),
        0
      );

      startOffset += content.length - overlap.join(' ').length;
      currentChunk = [...overlap, sentence];
      currentTokens = overlapTokens + sentenceTokens;
    } else {
      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
    }
  }

  if (currentChunk.length > 0) {
    const content = currentChunk.join(' ');
    chunks.push({
      content,
      tokenCount: currentTokens,
      startOffset,
      endOffset: startOffset + content.length,
    });
  }

  return chunks;
}
