import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownPlugin } from './plugin';

describe('MarkdownPlugin', () => {
  const plugin = new MarkdownPlugin();
  const testDir = join(tmpdir(), 'md-plugin-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('markdown');
    });

    it('should support md and markdown extensions', () => {
      expect(plugin.supportedExtensions).toContain('md');
      expect(plugin.supportedExtensions).toContain('markdown');
    });
  });

  describe('toMarkdown', () => {
    it('should return original content', async () => {
      const content = '# Title\n\nSome content here.';
      const filePath = join(testDir, 'test.md');
      writeFileSync(filePath, content);

      const result = await plugin.toMarkdown(filePath);
      expect(result.markdown).toBe(content);
    });

    it('should generate paragraph mapping', async () => {
      const content = '# Title\n\nParagraph 1.\n\nParagraph 2.';
      const filePath = join(testDir, 'test.md');
      writeFileSync(filePath, content);

      const result = await plugin.toMarkdown(filePath);
      expect(result.mapping.length).toBeGreaterThan(0);
    });

    it('should handle empty file', async () => {
      const filePath = join(testDir, 'empty.md');
      writeFileSync(filePath, '');

      const result = await plugin.toMarkdown(filePath);
      expect(result.markdown).toBe('');
      expect(result.mapping).toHaveLength(0);
    });

    it('should handle single line file', async () => {
      const content = 'Single line content';
      const filePath = join(testDir, 'single.md');
      writeFileSync(filePath, content);

      const result = await plugin.toMarkdown(filePath);
      expect(result.markdown).toBe(content);
      expect(result.mapping.length).toBe(1);
      expect(result.mapping[0].originalLocator).toBe('line:1-1');
    });

    it('should handle Chinese content', async () => {
      const content = '# 标题\n\n这是中文内容。\n\n第二段。';
      const filePath = join(testDir, 'chinese.md');
      writeFileSync(filePath, content);

      const result = await plugin.toMarkdown(filePath);
      expect(result.markdown).toBe(content);
      expect(result.mapping.length).toBeGreaterThan(0);
    });
  });

  describe('parseLocator', () => {
    it('should parse single line locator', () => {
      const info = plugin.parseLocator('line:42');
      expect(info.displayText).toBe('第 42 行');
      expect(info.jumpInfo).toEqual({ line: 42 });
    });

    it('should parse range locator', () => {
      const info = plugin.parseLocator('line:10-20');
      expect(info.displayText).toBe('第 10-20 行');
      expect(info.jumpInfo).toEqual({ startLine: 10, endLine: 20 });
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
});
