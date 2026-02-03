import type { LLMConfig } from '@agent-fs/core';
import { SummaryCache } from './cache';
import {
  CHUNK_SUMMARY_PROMPT,
  DOCUMENT_SUMMARY_PROMPT,
  DIRECTORY_SUMMARY_PROMPT,
} from './prompts';

export interface SummaryOptions {
  useCache?: boolean;
  maxRetries?: number;
}

export interface SummaryResult {
  summary: string;
  fromCache: boolean;
  fallback: boolean;
}

export class SummaryService {
  private config: LLMConfig;
  private cache: SummaryCache;

  constructor(config: LLMConfig) {
    this.config = config;
    this.cache = new SummaryCache(config.model);
  }

  async generateChunkSummary(
    content: string,
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const { useCache = true, maxRetries = 3 } = options;

    if (useCache) {
      const cached = this.cache.get(content, 'chunk');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = CHUNK_SUMMARY_PROMPT.replace('{content}', content);
      const summary = await this.callLLM(prompt, maxRetries);

      if (useCache) {
        this.cache.set(content, 'chunk', summary);
      }

      return { summary, fromCache: false, fallback: false };
    } catch {
      const fallbackSummary = this.extractFirstParagraph(content);
      return { summary: fallbackSummary, fromCache: false, fallback: true };
    }
  }

  async generateDocumentSummary(
    filename: string,
    chunkSummaries: string[],
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const content = `${filename}\n${chunkSummaries.join('\n')}`;

    if (options.useCache !== false) {
      const cached = this.cache.get(content, 'document');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = DOCUMENT_SUMMARY_PROMPT
        .replace('{filename}', filename)
        .replace('{chunk_summaries}', chunkSummaries.join('\n'));

      const summary = await this.callLLM(prompt, options.maxRetries ?? 3);

      this.cache.set(content, 'document', summary);
      return { summary, fromCache: false, fallback: false };
    } catch {
      const fallbackSummary = chunkSummaries.slice(0, 3).join(' ');
      return { summary: fallbackSummary, fromCache: false, fallback: true };
    }
  }

  async generateDirectorySummary(
    path: string,
    fileSummaries: string[],
    subdirSummaries: string[],
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const content = `${path}\n${fileSummaries.join('\n')}\n${subdirSummaries.join('\n')}`;

    if (options.useCache !== false) {
      const cached = this.cache.get(content, 'directory');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = DIRECTORY_SUMMARY_PROMPT
        .replace('{path}', path)
        .replace('{file_summaries}', fileSummaries.join('\n'))
        .replace('{subdirectory_summaries}', subdirSummaries.join('\n'));

      const summary = await this.callLLM(prompt, options.maxRetries ?? 3);

      this.cache.set(content, 'directory', summary);
      return { summary, fromCache: false, fallback: false };
    } catch {
      const fallbackSummary = `包含 ${fileSummaries.length} 个文件和 ${subdirSummaries.length} 个子目录`;
      return { summary: fallbackSummary, fromCache: false, fallback: true };
    }
  }

  private async callLLM(prompt: string, maxRetries: number): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.config.base_url}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.api_key}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            temperature: 0.3,
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = (await response.json()) as {
          choices: Array<{
            message: {
              content: string;
            };
          }>;
        };
        return data.choices[0].message.content.trim();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError ?? new Error('Failed to generate summary');
  }

  private extractFirstParagraph(content: string): string {
    const paragraphs = content.split('\n\n');
    const firstPara = paragraphs[0] || content;
    return firstPara.slice(0, 200) + (firstPara.length > 200 ? '...' : '');
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function createSummaryService(config: LLMConfig): SummaryService {
  return new SummaryService(config);
}
