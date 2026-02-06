import { describe, it, expect } from 'vitest';
import { MarkdownChunker } from './markdown-chunker';

describe('MarkdownChunker', () => {
  const chunker = new MarkdownChunker({
    minTokens: 50,
    maxTokens: 200,
    overlapRatio: 0.1,
  });

  it('should chunk simple markdown by headings', () => {
    const markdown = `# Title

Introduction paragraph.

## Section 1

Content of section 1.

## Section 2

Content of section 2.
`;

    const chunks = chunker.chunk(markdown);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should include line numbers in locator', () => {
    const markdown = `# Title

Some content here.
`;
    const chunks = chunker.chunk(markdown);
    expect(chunks[0].locator).toMatch(/^line:\d+-\d+$/);
  });

  it('should handle markdown without headings', () => {
    const markdown = `This is a document without headings.

It has multiple paragraphs.

Each paragraph is separate.`;

    const chunks = chunker.chunk(markdown);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should split large sections', () => {
    const largeParagraph = 'This is a sentence. '.repeat(100);
    const markdown = `# Large Section

${largeParagraph}
`;

    const largeChunker = new MarkdownChunker({
      minTokens: 10,
      maxTokens: 50,
    });

    const chunks = largeChunker.chunk(markdown);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  it('should merge small chunks', () => {
    const markdown = `# A

X.

# B

Y.

# C

Z.`;

    const mergeChunker = new MarkdownChunker({
      minTokens: 50,
      maxTokens: 200,
    });

    const chunks = mergeChunker.chunk(markdown);
    expect(chunks.length).toBeLessThan(4);
  });

  it('should handle Chinese content', () => {
    const markdown = `# 标题

这是一段中文内容。

## 第一节

这是第一节的内容，包含多个句子。每个句子都有意义。

## 第二节

这是第二节的内容。
`;

    const chunks = chunker.chunk(markdown);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should provide correct markdownRange', () => {
    const markdown = `# Title

Content.

## Section

More content.
`;
    const chunks = chunker.chunk(markdown);

    for (const chunk of chunks) {
      expect(chunk.lineStart).toBeGreaterThanOrEqual(1);
      expect(chunk.lineEnd).toBeGreaterThanOrEqual(chunk.lineStart);
      expect(chunk.markdownRange.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.markdownRange.endLine).toBeGreaterThanOrEqual(
        chunk.markdownRange.startLine
      );
    }
  });
});
