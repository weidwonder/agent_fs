import { describe, it, expect } from 'vitest';
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
