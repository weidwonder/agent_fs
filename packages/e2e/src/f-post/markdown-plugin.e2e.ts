import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: Markdown Plugin Integration', () => {
  let tempDir: string;
  let plugin: MarkdownPlugin;

  beforeEach(() => {
    tempDir = createTempTestDir();
    plugin = new MarkdownPlugin();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('toMarkdown', () => {
    it('should convert markdown file and preserve content', async () => {
      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

      const result = await plugin.toMarkdown(filePath);

      expect(result.markdown).toBeDefined();
      expect(result.markdown.length).toBeGreaterThan(0);
      expect(result.mapping).toBeDefined();
      expect(result.mapping.length).toBeGreaterThan(0);
    });

    it('should create valid position mappings', async () => {
      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

      const result = await plugin.toMarkdown(filePath);

      for (const mapping of result.mapping) {
        expect(mapping.markdownRange.startLine).toBeGreaterThan(0);
        expect(mapping.markdownRange.endLine).toBeGreaterThanOrEqual(mapping.markdownRange.startLine);
        expect(mapping.originalLocator).toMatch(/^line:\d+(-\d+)?$/);
      }
    });
  });

  describe('parseLocator', () => {
    it('should parse single line locator', () => {
      const info = plugin.parseLocator('line:42');
      expect(info.displayText).toBe('第 42 行');
      expect(info.jumpInfo).toEqual({ line: 42 });
    });

    it('should parse line range locator', () => {
      const info = plugin.parseLocator('line:10-20');
      expect(info.displayText).toBe('第 10-20 行');
      expect(info.jumpInfo).toEqual({ startLine: 10, endLine: 20 });
    });
  });

  describe('chunking integration', () => {
    it('should chunk markdown content correctly', async () => {
      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

      const result = await plugin.toMarkdown(filePath);
      const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
      const chunks = chunker.chunk(result.markdown);

      expect(chunks.length).toBeGreaterThan(0);

      for (const chunk of chunks) {
        expect(chunk.content).toBeDefined();
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.locator).toBeDefined();
      }
    });

    it('should handle tables and special markdown elements', async () => {
      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('<table>');

      const result = await plugin.toMarkdown(filePath);
      const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
      const chunks = chunker.chunk(result.markdown);

      const hasTableContent = chunks.some(
        (chunk) => chunk.content.includes('table') || chunk.content.includes('|')
      );
      expect(hasTableContent).toBe(true);
    });
  });
});
