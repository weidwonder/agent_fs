import type {
  DocumentConversionResult,
  DocumentPlugin,
  LocatorInfo,
} from '@agent-fs/core';
import {
  buildMinerUPositionMapping,
  extractMinerUPageTextMap,
} from './mineru-mapping';
import { convertPDFWithMinerU, type MinerUOptions, type MinerUResult } from './mineru';
import { extractPageFromLocator, insertPageMarkers } from './page-markers';
import {
  classifyDocument,
  directTextToMarkdown,
  extractTextPerPage,
  type DocumentClassification,
  type PageClassification,
  type TextExtractionOptions,
} from './pdf-text-extractor';

let minerUConversionQueue: Promise<void> = Promise.resolve();

function runWithMinerUConversionLock<T>(task: () => Promise<T>): Promise<T> {
  const run = minerUConversionQueue.then(task, task);
  minerUConversionQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface PDFPluginOptions {
  minerU?: MinerUOptions;
  textExtraction?: TextExtractionOptions;
}

export class PDFPlugin implements DocumentPlugin {
  readonly name = 'pdf';
  readonly supportedExtensions = ['pdf'];

  private options: PDFPluginOptions;

  constructor(options: PDFPluginOptions = {}) {
    this.options = options;
  }

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    if (this.options.textExtraction?.enabled === false) {
      return this.convertViaMinerU(
        filePath,
        '已禁用文本优先模式，但未配置 MinerU，请在插件配置中提供 minerU.serverUrl',
      );
    }

    let extractedPages: Awaited<ReturnType<typeof extractTextPerPage>>;
    try {
      extractedPages = await extractTextPerPage(filePath);
    } catch (error) {
      return this.handleTextExtractionFailure(filePath, error);
    }

    const classification = classifyDocument(
      extractedPages,
      this.options.textExtraction?.minTextCharsPerPage,
    );

    switch (classification.type) {
      case 'text':
        return this.convertDirectText(classification.pages);
      case 'scan':
        return this.convertViaMinerU(
          filePath,
          '检测到扫描件但未配置 MinerU，请在插件配置中提供 minerU.serverUrl',
        );
      case 'mixed':
        return this.convertHybrid(filePath, classification);
    }
  }

  parseLocator(locator: string): LocatorInfo {
    const pageMatch = locator.match(/^page:(\d+)(?::(.+))?$/u);
    if (!pageMatch) {
      return { displayText: locator };
    }

    const pageNum = Number.parseInt(pageMatch[1], 10);
    const bboxStr = pageMatch[2];

    if (!bboxStr) {
      return {
        displayText: `第 ${pageNum} 页`,
        jumpInfo: { page: pageNum },
      };
    }

    return {
      displayText: `第 ${pageNum} 页 (${bboxStr})`,
      jumpInfo: { page: pageNum, bbox: bboxStr },
    };
  }

  async init(): Promise<void> {
    // 暂无初始化逻辑
  }

  async dispose(): Promise<void> {
    // 暂无销毁逻辑
  }

  private async handleTextExtractionFailure(
    filePath: string,
    error: unknown,
  ): Promise<DocumentConversionResult> {
    if (this.options.minerU?.serverUrl) {
      return this.convertViaMinerU(filePath);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF 文本提取失败，且未配置 MinerU 回退：${message}`);
  }

  private convertDirectText(
    pages: PageClassification[],
  ): DocumentConversionResult {
    const result = directTextToMarkdown(pages);
    return this.finalizeConversionResult(result.markdown, result.mapping);
  }

  private async convertViaMinerU(
    filePath: string,
    missingConfigMessage = '未配置 MinerU，请在插件配置中提供 minerU.serverUrl',
  ): Promise<DocumentConversionResult> {
    const minerUOptions = this.options.minerU;
    if (!minerUOptions?.serverUrl) {
      throw new Error(missingConfigMessage);
    }

    const result = await runWithMinerUConversionLock(() =>
      convertPDFWithMinerU(filePath, minerUOptions),
    );

    return this.finalizeConversionResult(
      result.markdown,
      buildMinerUPositionMapping(result),
    );
  }

  private async convertHybrid(
    filePath: string,
    classification: DocumentClassification,
  ): Promise<DocumentConversionResult> {
    if (!this.options.minerU?.serverUrl) {
      return this.convertMixedWithoutMinerU(classification);
    }

    const minerUResult = await runWithMinerUConversionLock(() =>
      convertPDFWithMinerU(filePath, this.options.minerU as MinerUOptions),
    );

    return this.mergeHybridResults(classification, minerUResult);
  }

  private convertMixedWithoutMinerU(
    classification: DocumentClassification,
  ): DocumentConversionResult {
    const pages = classification.pages.map((page) =>
      page.type === 'text'
        ? page
        : {
            ...page,
            extractedText: '[扫描页，需配置 MinerU]',
          },
    );

    return this.convertDirectText(pages);
  }

  private mergeHybridResults(
    classification: DocumentClassification,
    minerUResult: MinerUResult,
  ): DocumentConversionResult {
    const minerUPageTextMap = extractMinerUPageTextMap(minerUResult);
    const mergedPages = classification.pages.map((page) => {
      if (page.type === 'text') {
        return page;
      }

      return {
        ...page,
        extractedText:
          minerUPageTextMap.get(page.pageNumber) ??
          '[扫描页，MinerU 未返回可提取内容]',
      };
    });

    return this.convertDirectText(mergedPages);
  }

  private finalizeConversionResult(
    markdown: string,
    mapping: DocumentConversionResult['mapping'],
  ): DocumentConversionResult {
    const withPageMarkers = insertPageMarkers(markdown, mapping);
    return {
      markdown: withPageMarkers.markdown,
      mapping: withPageMarkers.mappings,
    };
  }
}

export function createPDFPlugin(options?: PDFPluginOptions): DocumentPlugin {
  return new PDFPlugin(options);
}

export { extractPageFromLocator, insertPageMarkers };
