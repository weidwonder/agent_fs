import { describe, expect, it } from 'vitest';
import { PDFPlugin } from './plugin';
import { extractPageFromLocator, insertPageMarkers } from './page-markers';

describe('PDFPlugin', () => {
  const plugin = new PDFPlugin();

  describe('properties', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('pdf');
    });

    it('should support pdf extension', () => {
      expect(plugin.supportedExtensions).toContain('pdf');
    });
  });

  describe('parseLocator', () => {
    it('should parse simple page locator', () => {
      const info = plugin.parseLocator('page:5');
      expect(info.displayText).toBe('第 5 页');
      expect(info.jumpInfo).toEqual({ page: 5 });
    });

    it('should parse page with bbox locator', () => {
      const info = plugin.parseLocator('page:3:100,200,300,400');
      expect(info.displayText).toContain('第 3 页');
      expect(info.jumpInfo).toEqual({
        page: 3,
        bbox: '100,200,300,400',
      });
    });

    it('should handle invalid locator', () => {
      const info = plugin.parseLocator('invalid');
      expect(info.displayText).toBe('invalid');
      expect(info.jumpInfo).toBeUndefined();
    });
  });

  describe('lifecycle', () => {
    it('should init without error', async () => {
      await expect(plugin.init()).resolves.toBeUndefined();
    });

    it('should dispose without error', async () => {
      await expect(plugin.dispose()).resolves.toBeUndefined();
    });
  });

  describe('page markers', () => {
    it('应提取 page locator 中的页码', () => {
      expect(extractPageFromLocator('page:5')).toBe(5);
      expect(extractPageFromLocator('page:3:100,200,300,400')).toBe(3);
      expect(extractPageFromLocator('invalid')).toBeNull();
    });

    it('应在多页 markdown 中插入页码注释并同步重算 mapping', () => {
      const result = insertPageMarkers(
        '第一页标题\n第一页内容\n第二页标题\n第二页内容',
        [
          {
            markdownRange: { startLine: 1, endLine: 2 },
            originalLocator: 'page:1',
          },
          {
            markdownRange: { startLine: 3, endLine: 4 },
            originalLocator: 'page:2',
          },
        ],
      );

      expect(result.markdown).toContain('<!-- page: 1 -->');
      expect(result.markdown).toContain('<!-- page: 2 -->');
      expect(result.markdown.match(/<!-- page: \d+ -->/gu)).toHaveLength(2);

      const lines = result.markdown.split('\n');
      expect(lines[result.mappings[0].markdownRange.startLine - 1]).toBe('第一页标题');
      expect(lines[result.mappings[1].markdownRange.startLine - 1]).toBe('第二页标题');
    });

    it('应在单页文档文件头插入页码注释', () => {
      const result = insertPageMarkers('单页内容', [
        {
          markdownRange: { startLine: 1, endLine: 1 },
          originalLocator: 'page:1',
        },
      ]);

      expect(result.markdown).toBe('<!-- page: 1 -->\n\n单页内容');
      expect(result.mappings[0].markdownRange).toEqual({ startLine: 3, endLine: 3 });
    });

    it('无 page locator mapping 时应保持原样', () => {
      const result = insertPageMarkers('表头\n表体', [
        {
          markdownRange: { startLine: 1, endLine: 2 },
          originalLocator: 'sheet:总览/range:A1:B2',
        },
      ]);

      expect(result).toEqual({
        markdown: '表头\n表体',
        mappings: [
          {
            markdownRange: { startLine: 1, endLine: 2 },
            originalLocator: 'sheet:总览/range:A1:B2',
          },
        ],
      });
    });
  });

  // toMarkdown 测试需要 MinerU 环境
  describe('toMarkdown', () => {
    it.todo('should convert PDF to Markdown using MinerU');
    it.todo('should generate position mapping');
    it.todo('should handle multi-page PDF');
    it.todo('should fallback to page-based mapping if detailed mapping unavailable');
  });
});
