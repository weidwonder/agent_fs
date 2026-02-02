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
  type MinerUBlock,
} from './mineru';

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
    if (!minerUOptions) {
      throw new Error('未配置 MinerU，请在插件配置中提供 apiHost');
    }

    // 调用 MinerU 转换
    const result = await convertPDFWithMinerU(filePath, minerUOptions);

    // 构建 PositionMapping
    const mapping = this.buildPositionMapping(result);

    return {
      markdown: result.markdown,
      mapping,
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
   * 从 MinerU 的 content_list_v2.json 构建页级映射
   */
  private buildPositionMapping(result: {
    markdown: string;
    contentList?: MinerUContentList;
  }): PositionMapping[] {
    if (!result.contentList || result.contentList.length === 0) {
      // 如果没有 contentList，回退到简单策略
      return this.fallbackPageMapping(result.markdown);
    }

    const markdownLines = result.markdown.split('\n');
    const mapping: PositionMapping[] = [];

    let currentLine = 1;

    // 遍历每一页
    for (let pageIdx = 0; pageIdx < result.contentList.length; pageIdx += 1) {
      const page = result.contentList[pageIdx];
      const pageNumber = pageIdx + 1;

      // 提取该页的所有文本内容
      const pageTexts = this.extractPageTexts(page);

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
      }
    }

    return mapping;
  }

  /**
   * 提取页面的所有文本内容
   */
  private extractPageTexts(page: MinerUBlock[]): string[] {
    const texts: string[] = [];

    for (const block of page) {
      if (block.content.title_content) {
        for (const item of block.content.title_content) {
          if (item.content) {
            texts.push(item.content.trim());
          }
        }
      }
      if (block.content.paragraph_content) {
        for (const item of block.content.paragraph_content) {
          if (item.content) {
            texts.push(item.content.trim());
          }
        }
      }
    }

    return texts.filter((t) => t.length > 0);
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
