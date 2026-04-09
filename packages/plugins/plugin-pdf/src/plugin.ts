import type {
  DocumentConversionResult,
  DocumentPlugin,
  LocatorInfo,
  PositionMapping,
} from '@agent-fs/core';
import {
  convertPDFWithMinerU,
  type MinerUOptions,
  type MinerUContentList,
  type MinerUContentItem,
} from './mineru';

export function extractPageFromLocator(locator: string): number | null {
  const match = locator.match(/^page:(\d+)(?:$|[:/])/u);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

export function insertPageMarkers(
  markdown: string,
  mappings: PositionMapping[],
): { markdown: string; mappings: PositionMapping[] } {
  if (!markdown.trim() || mappings.length === 0) {
    return { markdown, mappings };
  }

  const lines = markdown.split('\n');
  const adjustedMappings = mappings.map((mapping) => ({
    markdownRange: { ...mapping.markdownRange },
    originalLocator: mapping.originalLocator,
  }));
  const sortedMappings = [...adjustedMappings].sort(
    (left, right) =>
      left.markdownRange.startLine - right.markdownRange.startLine,
  );

  let currentPage: number | null = null;
  let offset = 0;

  for (const mapping of sortedMappings) {
    mapping.markdownRange.startLine += offset;
    mapping.markdownRange.endLine += offset;

    const page = extractPageFromLocator(mapping.originalLocator);
    if (!page || page === currentPage) {
      continue;
    }

    const markerLines =
      mapping.markdownRange.startLine === 1
        ? [`<!-- page: ${page} -->`, '']
        : ['', `<!-- page: ${page} -->`, ''];

    lines.splice(mapping.markdownRange.startLine - 1, 0, ...markerLines);
    mapping.markdownRange.startLine += markerLines.length;
    mapping.markdownRange.endLine += markerLines.length;
    offset += markerLines.length;
    currentPage = page;
  }

  return {
    markdown: lines.join('\n'),
    mappings: adjustedMappings,
  };
}

let minerUConversionQueue: Promise<void> = Promise.resolve();

function runWithMinerUConversionLock<T>(task: () => Promise<T>): Promise<T> {
  const run = minerUConversionQueue.then(task, task);
  minerUConversionQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * PDF 插件配置
 */
export interface PDFPluginOptions {
  /** MinerU 配置 */
  minerU?: MinerUOptions;
}

/**
 * PDF 文档处理插件
 *
 * 使用 MinerU 将 PDF 转换为 Markdown，并保留位置映射
 */
export class PDFPlugin implements DocumentPlugin {
  /** 插件名称 */
  readonly name = 'pdf';

  /** 支持的文件扩展名 */
  readonly supportedExtensions = ['pdf'];

  private options: PDFPluginOptions;

  constructor(options: PDFPluginOptions = {}) {
    this.options = options;
  }

  /**
   * 将 PDF 转换为 Markdown
   */
  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const minerUOptions = this.options.minerU;
    if (!minerUOptions?.serverUrl) {
      throw new Error('未配置 MinerU，请在插件配置中提供 serverUrl');
    }

    const result = await runWithMinerUConversionLock(() =>
      convertPDFWithMinerU(filePath, minerUOptions),
    );

    // 构建 PositionMapping
    const mapping = this.buildPositionMapping(result);
    const withPageMarkers = insertPageMarkers(result.markdown, mapping);

    return {
      markdown: withPageMarkers.markdown,
      mapping: withPageMarkers.mappings,
    };
  }

  /**
   * 解析定位符
   */
  parseLocator(locator: string): LocatorInfo {
    // 格式1: page:N
    // 格式2: page:N:x,y,w,h (页码:坐标区域)
    const pageMatch = locator.match(/^page:(\d+)(?::(.+))?$/);

    if (!pageMatch) {
      return {
        displayText: locator,
      };
    }

    const pageNum = Number.parseInt(pageMatch[1], 10);
    const bboxStr = pageMatch[2];

    if (!bboxStr) {
      // 仅页码
      return {
        displayText: `第 ${pageNum} 页`,
        jumpInfo: { page: pageNum },
      };
    }

    // 包含坐标区域
    return {
      displayText: `第 ${pageNum} 页 (${bboxStr})`,
      jumpInfo: { page: pageNum, bbox: bboxStr },
    };
  }

  /**
   * 构建 PositionMapping
   * 从 MinerU 的 content list 构建页级映射
   */
  private buildPositionMapping(result: {
    markdown: string;
    contentList?: MinerUContentList;
    totalPages?: number;
  }): PositionMapping[] {
    const markdownLines = result.markdown.split('\n');
    const totalLines = markdownLines.length;
    const contentList = result.contentList ?? [];
    const totalPages = this.getTotalPages(contentList, result.totalPages);

    if (!totalPages) {
      // 如果无法确定页数，回退到简单策略
      return this.fallbackPageMapping(result.markdown);
    }

    const mapping: PositionMapping[] = [];
    const pages = this.groupContentByPage(contentList, totalPages);
    let currentLine = 1;

    // 遍历每一页
    for (let pageIdx = 0; pageIdx < totalPages; pageIdx += 1) {
      const pageNumber = pageIdx + 1;
      const pageItems = pages[pageIdx] ?? [];

      if (currentLine > totalLines) {
        break;
      }

      // 提取该页的所有文本内容
      const pageTexts = this.extractPageTexts(pageItems);

      // 在 Markdown 中查找该页的起始和结束行
      const pageRange = this.findPageRangeInMarkdown(
        markdownLines,
        pageTexts,
        currentLine,
      );

      if (pageRange) {
        mapping.push({
          markdownRange: {
            startLine: pageRange.startLine,
            endLine: pageRange.endLine,
          },
          originalLocator: `page:${pageNumber}`,
        });
        currentLine = pageRange.endLine + 1;
        continue;
      }

      // 回退策略：按剩余行数平均分配到剩余页
      const remainingLines = totalLines - currentLine + 1;
      const remainingPages = totalPages - pageIdx;
      const linesPerPage = Math.max(
        1,
        Math.ceil(remainingLines / remainingPages),
      );
      const startLine = currentLine;
      const endLine = Math.min(currentLine + linesPerPage - 1, totalLines);

      mapping.push({
        markdownRange: { startLine, endLine },
        originalLocator: `page:${pageNumber}`,
      });

      currentLine = endLine + 1;
    }

    return mapping;
  }

  /**
   * 提取页面的所有文本内容
   */
  private extractPageTexts(pageItems: MinerUContentItem[]): string[] {
    const texts: string[] = [];

    for (const item of pageItems) {
      this.collectText(texts, item.text);
      this.collectText(texts, item.list_items);
      this.collectText(texts, item['table_body']);
      this.collectText(texts, item['code_body']);
      this.collectText(texts, item['image_caption']);
      this.collectText(texts, item['table_caption']);
      this.collectText(texts, item['image_footnote']);
      this.collectText(texts, item['table_footnote']);
    }

    return texts.filter((t) => t.length > 0);
  }

  private collectText(texts: string[], value: unknown): void {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        texts.push(trimmed);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed) {
            texts.push(trimmed);
          }
        }
      }
    }
  }

  private getTotalPages(
    contentList: MinerUContentList,
    totalPages?: number,
  ): number | null {
    if (typeof totalPages === 'number' && totalPages > 0) {
      return totalPages;
    }

    let maxPageIdx = -1;
    for (const item of contentList) {
      if (typeof item.page_idx === 'number' && item.page_idx > maxPageIdx) {
        maxPageIdx = item.page_idx;
      }
    }

    return maxPageIdx >= 0 ? maxPageIdx + 1 : null;
  }

  private groupContentByPage(
    contentList: MinerUContentList,
    totalPages: number,
  ): MinerUContentItem[][] {
    const pages: MinerUContentItem[][] = Array.from(
      { length: totalPages },
      () => [],
    );

    for (const item of contentList) {
      if (typeof item.page_idx !== 'number') {
        continue;
      }
      if (item.page_idx < 0 || item.page_idx >= totalPages) {
        continue;
      }
      pages[item.page_idx].push(item);
    }

    return pages;
  }

  /**
   * 在 Markdown 中查找页面的行号范围
   */
  private findPageRangeInMarkdown(
    markdownLines: string[],
    pageTexts: string[],
    startLine: number,
  ): { startLine: number; endLine: number } | null {
    if (pageTexts.length === 0) return null;

    // 查找该页第一个文本在 Markdown 中的位置
    const firstText = pageTexts[0];
    let foundStart = -1;

    for (let i = startLine - 1; i < markdownLines.length; i += 1) {
      if (markdownLines[i].includes(firstText)) {
        foundStart = i + 1;
        break;
      }
    }

    if (foundStart === -1) return null;

    // 查找该页最后一个文本在 Markdown 中的位置
    const lastText = pageTexts[pageTexts.length - 1];
    let foundEnd = foundStart;

    for (let i = foundStart - 1; i < markdownLines.length; i += 1) {
      if (markdownLines[i].includes(lastText)) {
        foundEnd = i + 1;
        break;
      }
    }

    return { startLine: foundStart, endLine: foundEnd };
  }

  /**
   * 回退方案：简单平均分配
   * 当 MinerU 没有提供 contentList 时使用
   */
  private fallbackPageMapping(markdown: string): PositionMapping[] {
    const lines = markdown.split('\n');
    const totalLines = lines.length;

    // 假设平均每页 20 行（简单估算）
    const estimatedPages = Math.ceil(totalLines / 20);
    const linesPerPage = Math.ceil(totalLines / estimatedPages);

    const mapping: PositionMapping[] = [];

    for (let page = 1; page <= estimatedPages; page += 1) {
      const startLine = (page - 1) * linesPerPage + 1;
      const endLine = Math.min(page * linesPerPage, totalLines);

      mapping.push({
        markdownRange: { startLine, endLine },
        originalLocator: `page:${page}`,
      });
    }

    return mapping;
  }

  /** 初始化 */
  async init(): Promise<void> {
    // 可在此检查 MinerU 是否可用
    // 暂时跳过，首次调用时会报错
  }

  /** 销毁 */
  async dispose(): Promise<void> {
    // 无需清理
  }
}

/**
 * 创建 PDF 插件实例
 */
export function createPDFPlugin(options?: PDFPluginOptions): DocumentPlugin {
  return new PDFPlugin(options);
}
