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

  it('已有 sheet/range 定位符应保持不变', () => {
    const locator = resolveDisplayLocator({
      filePath: '/tmp/report.xlsx',
      locator: 'sheet:库存/range:B2:E9',
      chunkLineStart: 2,
      chunkLineEnd: 9,
      mappings: [
        {
          markdownRange: { startLine: 2, endLine: 9 },
          originalLocator: 'sheet:库存/range:B2:E9',
        },
      ],
    });

    expect(locator).toBe('sheet:库存/range:B2:E9');
  });

  it('非 Excel 文件应保持原定位符', () => {
    const locator = resolveDisplayLocator({
      filePath: '/tmp/readme.md',
      locator: 'line:2-3',
      chunkLineStart: 2,
      chunkLineEnd: 3,
      mappings: [
        {
          markdownRange: { startLine: 2, endLine: 3 },
          originalLocator: 'sheet:不应使用/range:A1:A2',
        },
      ],
    });

    expect(locator).toBe('line:2-3');
  });
});
