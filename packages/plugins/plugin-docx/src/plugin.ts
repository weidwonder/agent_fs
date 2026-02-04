import type {
  DocumentConversionResult,
  DocumentPlugin,
  LocatorInfo,
  PositionMapping,
} from '@agent-fs/core';
import { DocxService } from './service';

export interface DocxServiceLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  convert(filePath: string): Promise<{
    markdown: string;
    mappings: { startLine: number; endLine: number; locator: string }[];
  }>;
}

export interface DocxPluginOptions {
  service?: DocxServiceLike;
}

export class DocxPlugin implements DocumentPlugin {
  readonly name = 'docx';
  readonly supportedExtensions = ['doc', 'docx'];

  private service: DocxServiceLike;

  constructor(options: DocxPluginOptions = {}) {
    this.service = options.service ?? new DocxService();
  }

  async init(): Promise<void> {
    await this.service.start();
  }

  async dispose(): Promise<void> {
    await this.service.stop();
  }

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const result = await this.service.convert(filePath);

    const mapping: PositionMapping[] = result.mappings.map((item) => ({
      markdownRange: { startLine: item.startLine, endLine: item.endLine },
      originalLocator: item.locator,
    }));

    return { markdown: result.markdown, mapping };
  }

  parseLocator(locator: string): LocatorInfo {
    const headingMatch = locator.match(/^heading:(\d+):(.+)$/);
    if (headingMatch) {
      const level = Number.parseInt(headingMatch[1], 10);
      const title = headingMatch[2];
      return {
        displayText: `${'#'.repeat(level)} ${title}`,
        jumpInfo: { type: 'heading', level, title },
      };
    }

    const paraMatch = locator.match(/^para:(\d+)$/);
    if (paraMatch) {
      const index = Number.parseInt(paraMatch[1], 10);
      return {
        displayText: `第 ${index + 1} 段`,
        jumpInfo: { type: 'paragraph', index },
      };
    }

    const tableMatch = locator.match(/^table:(\d+)$/);
    if (tableMatch) {
      const index = Number.parseInt(tableMatch[1], 10);
      return {
        displayText: `表格 ${index + 1}`,
        jumpInfo: { type: 'table', index },
      };
    }

    return { displayText: locator };
  }
}

export function createDocxPlugin(options?: DocxPluginOptions): DocumentPlugin {
  return new DocxPlugin(options);
}
