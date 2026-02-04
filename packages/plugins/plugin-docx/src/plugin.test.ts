import { describe, it, expect, vi } from 'vitest';
import { DocxPlugin } from './plugin';

function createMockService() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    convert: vi.fn().mockResolvedValue({
      markdown: '# 标题',
      mappings: [
        { startLine: 1, endLine: 1, locator: 'heading:1:标题' },
        { startLine: 3, endLine: 3, locator: 'para:0' },
      ],
    }),
  };
}

describe('DocxPlugin', () => {
  it('should expose correct name and extensions', () => {
    const plugin = new DocxPlugin();
    expect(plugin.name).toBe('docx');
    expect(plugin.supportedExtensions).toContain('doc');
    expect(plugin.supportedExtensions).toContain('docx');
  });

  it('should convert mapping to PositionMapping', async () => {
    const service = createMockService();
    const plugin = new DocxPlugin({ service });

    const result = await plugin.toMarkdown('/tmp/demo.docx');
    expect(result.markdown).toBe('# 标题');
    expect(result.mapping).toEqual([
      {
        markdownRange: { startLine: 1, endLine: 1 },
        originalLocator: 'heading:1:标题',
      },
      {
        markdownRange: { startLine: 3, endLine: 3 },
        originalLocator: 'para:0',
      },
    ]);
  });

  it('should parse heading locator', () => {
    const plugin = new DocxPlugin();
    expect(plugin.parseLocator('heading:2:背景').displayText).toBe('## 背景');
  });

  it('should parse para locator', () => {
    const plugin = new DocxPlugin();
    expect(plugin.parseLocator('para:5').displayText).toBe('第 6 段');
  });

  it('should parse table locator', () => {
    const plugin = new DocxPlugin();
    expect(plugin.parseLocator('table:0').displayText).toBe('表格 1');
  });
});
