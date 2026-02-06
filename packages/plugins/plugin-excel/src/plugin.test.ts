import { describe, it, expect, vi } from 'vitest';
import { ExcelPlugin } from './plugin';

describe('ExcelPlugin', () => {
  const plugin = new ExcelPlugin();

  it('应该有正确的名称和扩展名', () => {
    expect(plugin.name).toBe('excel');
    expect(plugin.supportedExtensions).toEqual(['xls', 'xlsx']);
  });

  it('应该正确解析定位符', () => {
    const info = plugin.parseLocator('sheet:销售数据/range:A1:E25');

    expect(info.displayText).toBe('工作表 "销售数据" - 区域 A1:E25');
    expect(info.jumpInfo).toEqual({ sheet: '销售数据', range: 'A1:E25' });
  });

  it('应该处理无效定位符', () => {
    const info = plugin.parseLocator('invalid');

    expect(info.displayText).toBe('invalid');
    expect(info.jumpInfo).toBeUndefined();
  });

  it('应该输出 searchableText 并绑定到 markdown 行号', async () => {
    const searchableEntry = {
      text: '2026-02-01 产品A 销售额 100000',
      locator: 'sheet:销售数据/range:A1:C100',
    };
    const pluginWithMock = new ExcelPlugin();
    (pluginWithMock as any).client = {
      convert: vi.fn().mockResolvedValue({
        sheets: [
          {
            name: '销售数据',
            index: 0,
            regions: [
              {
                range: 'A1:C100',
                tables: ['A1:C100'],
                markdown: '|日期|产品|销售额|\n|---|---|---|\n|2026-02-01|产品A|100000|',
                searchableEntries: [searchableEntry],
              },
            ],
          },
        ],
      }),
    };

    const result = await pluginWithMock.toMarkdown('/tmp/sales.xlsx');

    expect(result.markdown).toContain('## 工作表：销售数据');
    expect(result.searchableText).toBeDefined();
    expect(result.searchableText).toHaveLength(1);
    expect(result.searchableText?.[0].locator).toBe(searchableEntry.locator);

    const mappingRange = result.mapping[0].markdownRange;
    const searchableLine = result.searchableText?.[0].markdownLine ?? 0;
    expect(searchableLine).toBeGreaterThanOrEqual(mappingRange.startLine);
    expect(searchableLine).toBeLessThanOrEqual(mappingRange.endLine);
  });

  it('缺失 searchableEntries 时应回退为区域文本索引', async () => {
    const pluginWithMock = new ExcelPlugin();
    (pluginWithMock as any).client = {
      convert: vi.fn().mockResolvedValue({
        sheets: [
          {
            name: '库存',
            index: 0,
            regions: [
              {
                range: 'C1:D5',
                tables: [],
                markdown: '|SKU|库存|\n|---|---|\n|A-1|20|',
              },
            ],
          },
        ],
      }),
    };

    const result = await pluginWithMock.toMarkdown('/tmp/stock.xlsx');
    expect(result.searchableText).toBeDefined();
    expect(result.searchableText).toHaveLength(1);
    expect(result.searchableText?.[0].locator).toBe('sheet:库存/range:C1:D5');
    expect(result.searchableText?.[0].text).toContain('库存');
  });
});

describe.skip('ExcelPlugin Integration', () => {
  it('应该正确转换 xlsx 文件', async () => {
    const plugin = new ExcelPlugin();
    await plugin.init();

    const result = await plugin.toMarkdown('/path/to/test.xlsx');

    expect(result.markdown).toBeTruthy();
    expect(result.mapping.length).toBeGreaterThan(0);

    await plugin.dispose();
  });
});
