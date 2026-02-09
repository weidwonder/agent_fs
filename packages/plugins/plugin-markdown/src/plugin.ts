import { readFileSync } from 'node:fs';
import type {
  DocumentConversionResult,
  DocumentPlugin,
  LocatorInfo,
  PositionMapping,
} from '@agent-fs/core';

/**
 * Markdown 文档处理插件
 */
export class MarkdownPlugin implements DocumentPlugin {
  /** 插件名称 */
  readonly name = 'markdown';

  /** 支持的文件扩展名（不含点） */
  readonly supportedExtensions = ['md', 'markdown', 'txt'];

  /**
   * 将 Markdown 文件转换为 Markdown（直接返回原内容）
   */
  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const mapping = this.createParagraphMapping(lines);

    return {
      markdown: content,
      mapping,
    };
  }

  /**
   * 解析定位符
   */
  parseLocator(locator: string): LocatorInfo {
    const match = locator.match(/^line:(\d+)(?:-(\d+))?$/);

    if (!match) {
      return {
        displayText: locator,
      };
    }

    const startLine = Number.parseInt(match[1], 10);
    const endLine = match[2] ? Number.parseInt(match[2], 10) : startLine;

    if (startLine === endLine) {
      return {
        displayText: `第 ${startLine} 行`,
        jumpInfo: { line: startLine },
      };
    }

    return {
      displayText: `第 ${startLine}-${endLine} 行`,
      jumpInfo: { startLine, endLine },
    };
  }

  /**
   * 创建段落级别的映射
   * 将连续的非空行合并为一个段落
   */
  private createParagraphMapping(lines: string[]): PositionMapping[] {
    const mapping: PositionMapping[] = [];
    let paragraphStart: number | null = null;

    for (let i = 0; i < lines.length; i += 1) {
      const lineNum = i + 1;
      const line = lines[i];
      const isEmpty = line.trim() === '';

      if (!isEmpty && paragraphStart === null) {
        paragraphStart = lineNum;
      } else if (isEmpty && paragraphStart !== null) {
        mapping.push({
          markdownRange: {
            startLine: paragraphStart,
            endLine: lineNum - 1,
          },
          originalLocator: `line:${paragraphStart}-${lineNum - 1}`,
        });
        paragraphStart = null;
      }
    }

    if (paragraphStart !== null) {
      mapping.push({
        markdownRange: {
          startLine: paragraphStart,
          endLine: lines.length,
        },
        originalLocator: `line:${paragraphStart}-${lines.length}`,
      });
    }

    return mapping;
  }

  /** 初始化 */
  async init(): Promise<void> {
    // Markdown 插件无需初始化
  }

  /** 销毁 */
  async dispose(): Promise<void> {
    // Markdown 插件无需清理
  }
}

/**
 * 创建 Markdown 插件实例
 */
export function createMarkdownPlugin(): DocumentPlugin {
  return new MarkdownPlugin();
}
