import { describe, expect, it } from 'vitest';
import { PDFPlugin } from './plugin';

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

  // toMarkdown 测试需要 MinerU 环境
  describe('toMarkdown', () => {
    it.todo('should convert PDF to Markdown using MinerU');
    it.todo('should generate position mapping');
    it.todo('should handle multi-page PDF');
    it.todo('should fallback to page-based mapping if detailed mapping unavailable');
  });
});
