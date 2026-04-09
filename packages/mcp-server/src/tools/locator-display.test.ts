import { describe, expect, it } from 'vitest';

import { resolveDisplayLocator } from './locator-display';

describe('resolveDisplayLocator', () => {
  it('Excel 行号定位符应优先映射为 sheet/range', () => {
    const locator = resolveDisplayLocator({
      filePath: '/tmp/report.xlsx',
      locator: 'line:11-15',
      chunkLineStart: 11,
      chunkLineEnd: 15,
      mappings: [
        {
          markdownRange: { startLine: 3, endLine: 10 },
          originalLocator: 'sheet:总览/range:A1:C10',
        },
        {
          markdownRange: { startLine: 11, endLine: 30 },
          originalLocator: 'sheet:明细/range:A1:F20',
        },
      ],
    });

    expect(locator).toBe('sheet:明细/range:A1:F20');
  });

  it('PDF 应回显页码', () => {
    const locator = resolveDisplayLocator({
      filePath: '/tmp/report.pdf',
      locator: 'page:3',
    });

    expect(locator).toBe('第 3 页');
  });

  it('DOCX 段落定位符应回显段号', () => {
    const locator = resolveDisplayLocator({
      filePath: '/tmp/report.docx',
      locator: 'para:12',
    });

    expect(locator).toBe('第 12 段');
  });

  it('DOCX 标题定位符应回显标题', () => {
    const locator = resolveDisplayLocator({
      filePath: '/tmp/report.docx',
      locator: 'heading:2:第二章',
    });

    expect(locator).toBe('标题 "第二章"');
  });

  it('DOCX 标题含冒号时应完整回显标题', () => {
    const locator = resolveDisplayLocator({
      filePath: '/tmp/report.docx',
      locator: 'heading:2:第一章：开始',
    });

    expect(locator).toBe('标题 "第一章：开始"');
  });

  it('DOCX 表格定位符应回显表号', () => {
    const locator = resolveDisplayLocator({
      filePath: '/tmp/report.docx',
      locator: 'table:1',
    });

    expect(locator).toBe('表 1');
  });
});
