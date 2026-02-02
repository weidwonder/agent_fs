import { encode, decode } from 'gpt-tokenizer';

/**
 * Tokenizer 选项
 */
export interface TokenizerOptions {
  /** 模型名称（用于选择 tokenizer） */
  model?: string;
}

/**
 * Tokenizer 接口
 */
export interface Tokenizer {
  /** 计算文本的 token 数 */
  count(text: string): number;

  /** 将文本编码为 token */
  encode(text: string): number[];

  /** 将 token 解码为文本 */
  decode(tokens: number[]): string;
}

/**
 * 创建 Tokenizer
 * 默认使用 GPT tokenizer（cl100k_base）
 */
export function createTokenizer(_options: TokenizerOptions = {}): Tokenizer {
  return {
    count(text: string): number {
      return encode(text).length;
    },
    encode(text: string): number[] {
      return encode(text);
    },
    decode(tokens: number[]): string {
      return decode(tokens);
    },
  };
}

/**
 * 快捷方法：计算 token 数
 */
export function countTokens(text: string): number {
  return encode(text).length;
}
