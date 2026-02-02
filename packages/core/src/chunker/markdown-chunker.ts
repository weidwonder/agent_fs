import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import type { Root, Heading } from 'mdast';
import { countTokens } from './tokenizer';
import { splitLargeBlock } from './sentence-splitter';
import type { ChunkMetadata, ChunkerOptions } from '../types/chunk';

/**
 * Markdown 切分器
 */
export class MarkdownChunker {
  private options: Required<ChunkerOptions>;

  constructor(options: ChunkerOptions) {
    this.options = {
      minTokens: options.minTokens,
      maxTokens: options.maxTokens,
      overlapRatio: options.overlapRatio ?? 0.1,
    };
  }

  /**
   * 切分 Markdown 文本
   */
  chunk(markdown: string): ChunkMetadata[] {
    const lines = markdown.split('\n');
    const tree = unified().use(remarkParse).parse(markdown) as Root;

    const sections = this.extractSections(tree, lines);
    const chunks: ChunkMetadata[] = [];

    for (const section of sections) {
      const tokenCount = countTokens(section.content);

      if (tokenCount <= this.options.maxTokens) {
        chunks.push({
          content: section.content,
          tokenCount,
          locator: `line:${section.startLine}-${section.endLine}`,
          markdownRange: {
            startLine: section.startLine,
            endLine: section.endLine,
          },
        });
      } else {
        const subChunks = splitLargeBlock(section.content, {
          maxTokens: this.options.maxTokens,
          overlapRatio: this.options.overlapRatio,
        });

        for (const subChunk of subChunks) {
          chunks.push({
            content: subChunk.content,
            tokenCount: subChunk.tokenCount,
            locator: `line:${section.startLine}-${section.endLine}`,
            markdownRange: {
              startLine: section.startLine,
              endLine: section.endLine,
            },
          });
        }
      }
    }

    return this.mergeSmallChunks(chunks);
  }

  /**
   * 提取按标题分隔的节
   */
  private extractSections(
    tree: Root,
    lines: string[]
  ): Array<{ content: string; startLine: number; endLine: number }> {
    const sections: Array<{
      content: string;
      startLine: number;
      endLine: number;
    }> = [];

    const headings: Array<{ line: number; depth: number }> = [];

    visit(tree, 'heading', (node: Heading) => {
      if (node.position) {
        headings.push({
          line: node.position.start.line,
          depth: node.depth,
        });
      }
    });

    if (headings.length === 0) {
      return [
        {
          content: lines.join('\n'),
          startLine: 1,
          endLine: lines.length,
        },
      ];
    }

    for (let i = 0; i < headings.length; i += 1) {
      const startLine = headings[i].line;
      const endLine =
        i < headings.length - 1 ? headings[i + 1].line - 1 : lines.length;

      const content = lines.slice(startLine - 1, endLine).join('\n');
      sections.push({ content, startLine, endLine });
    }

    if (headings[0].line > 1) {
      sections.unshift({
        content: lines.slice(0, headings[0].line - 1).join('\n'),
        startLine: 1,
        endLine: headings[0].line - 1,
      });
    }

    return sections.filter((section) => section.content.trim().length > 0);
  }

  /**
   * 合并过小的 chunks
   */
  private mergeSmallChunks(chunks: ChunkMetadata[]): ChunkMetadata[] {
    if (chunks.length <= 1) {
      return chunks;
    }

    const merged: ChunkMetadata[] = [];
    let current: ChunkMetadata | null = null;

    for (const chunk of chunks) {
      if (!current) {
        current = { ...chunk };
        continue;
      }

      const combinedTokens: number = current.tokenCount + chunk.tokenCount;

      if (
        combinedTokens <= this.options.maxTokens &&
        current.tokenCount < this.options.minTokens
      ) {
        current = {
          content: `${current.content}\n\n${chunk.content}`,
          tokenCount: combinedTokens,
          locator: `line:${current.markdownRange.startLine}-${chunk.markdownRange.endLine}`,
          markdownRange: {
            startLine: current.markdownRange.startLine,
            endLine: chunk.markdownRange.endLine,
          },
        };
      } else {
        merged.push(current);
        current = { ...chunk };
      }
    }

    if (current) {
      merged.push(current);
    }

    return merged;
  }
}
