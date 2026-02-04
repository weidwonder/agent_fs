import type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from '@agent-fs/core';
import { ConverterClient, type ConverterClientOptions } from './converter-client';

export interface ExcelPluginOptions {
  converter?: ConverterClientOptions;
}

export class ExcelPlugin implements DocumentPlugin {
  readonly name = 'excel';
  readonly supportedExtensions = ['xls', 'xlsx'];

  private client: ConverterClient | null = null;
  private options: ExcelPluginOptions;

  constructor(options: ExcelPluginOptions = {}) {
    this.options = options;
  }

  async init(): Promise<void> {
    this.client = new ConverterClient(this.options.converter);
    await this.client.start();
  }

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    if (!this.client) {
      throw new Error('Plugin not initialized. Call init() first.');
    }

    const response = await this.client.convert(filePath);

    let markdown = '';
    const mapping: PositionMapping[] = [];
    let currentLine = 1;

    for (const sheet of response.sheets) {
      markdown += `## Sheet: ${sheet.name}\n\n`;
      currentLine += 2;

      for (const region of sheet.regions) {
        markdown += `### 区域 ${region.range}\n`;
        currentLine += 1;

        if (region.tables.length > 0) {
          markdown += `Tables: ${region.tables.join(', ')}\n\n`;
        } else {
          markdown += 'Tables: (none)\n\n';
        }
        currentLine += 2;

        const regionStartLine = currentLine;
        const regionLines = region.markdown.split('\n');

        markdown += region.markdown;
        if (!region.markdown.endsWith('\n')) {
          markdown += '\n';
        }
        markdown += '\n';

        mapping.push({
          markdownRange: {
            startLine: regionStartLine,
            endLine: regionStartLine + regionLines.length - 1,
          },
          originalLocator: `sheet:${sheet.name}/range:${region.range}`,
        });

        currentLine += regionLines.length + 1;
      }
    }

    return { markdown, mapping };
  }

  parseLocator(locator: string): LocatorInfo {
    const match = locator.match(/^sheet:([^/]+)\/range:(.+)$/);
    if (!match) {
      return { displayText: locator };
    }

    const [, sheetName, range] = match;
    return {
      displayText: `工作表 "${sheetName}" - 区域 ${range}`,
      jumpInfo: { sheet: sheetName, range },
    };
  }

  async dispose(): Promise<void> {
    await this.client?.stop();
    this.client = null;
  }
}

export function createExcelPlugin(options?: ExcelPluginOptions): ExcelPlugin {
  return new ExcelPlugin(options);
}
