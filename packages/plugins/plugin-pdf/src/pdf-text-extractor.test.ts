import { describe, expect, it } from 'vitest';
import {
  classifyDocument,
  directTextToMarkdown,
  getDefaultMinTextCharsPerPage,
} from './pdf-text-extractor';

describe('pdf-text-extractor', () => {
  it('应按默认阈值正确分类纯文本、纯扫描与混合文档', () => {
    expect(getDefaultMinTextCharsPerPage()).toBe(100);

    expect(
      classifyDocument([
        { pageNumber: 1, text: 'a'.repeat(100), charCount: 100 },
        { pageNumber: 2, text: 'b'.repeat(120), charCount: 120 },
      ]).type,
    ).toBe('text');

    expect(
      classifyDocument([
        { pageNumber: 1, text: 'a'.repeat(10), charCount: 10 },
        { pageNumber: 2, text: '', charCount: 0 },
      ]).type,
    ).toBe('scan');

    const mixed = classifyDocument([
      { pageNumber: 1, text: 'a'.repeat(120), charCount: 120 },
      { pageNumber: 2, text: '短文本', charCount: 3 },
    ]);
    expect(mixed.type).toBe('mixed');
    expect(mixed.textPageCount).toBe(1);
    expect(mixed.scanPageCount).toBe(1);
  });

  it('应正确处理阈值边界 99/100/101 与自定义阈值', () => {
    const result = classifyDocument([
      { pageNumber: 1, text: 'a'.repeat(99), charCount: 99 },
      { pageNumber: 2, text: 'b'.repeat(100), charCount: 100 },
      { pageNumber: 3, text: 'c'.repeat(101), charCount: 101 },
    ]);

    expect(result.pages.map((page) => page.type)).toEqual(['scan', 'text', 'text']);

    const customThreshold = classifyDocument(
      [
        { pageNumber: 1, text: 'a'.repeat(49), charCount: 49 },
        { pageNumber: 2, text: 'b'.repeat(50), charCount: 50 },
      ],
      50,
    );

    expect(customThreshold.pages.map((page) => page.type)).toEqual(['scan', 'text']);
  });

  it('应生成带页分隔和精确 mapping 的 Markdown', () => {
    const result = directTextToMarkdown([
      {
        pageNumber: 1,
        type: 'text',
        charCount: 120,
        extractedText: '第一页第一行\n第一页第二行',
      },
      {
        pageNumber: 2,
        type: 'scan',
        charCount: 0,
        extractedText: '[扫描页，需配置 MinerU]',
      },
    ]);

    expect(result.markdown).toBe(
      '第一页第一行\n第一页第二行\n\n---\n\n[扫描页，需配置 MinerU]',
    );
    expect(result.mapping).toEqual([
      {
        markdownRange: { startLine: 1, endLine: 2 },
        originalLocator: 'page:1',
      },
      {
        markdownRange: { startLine: 6, endLine: 6 },
        originalLocator: 'page:2',
      },
    ]);
  });

  it('应忽略跨页重复页眉页脚，避免把图片页误判为文本', () => {
    const repeatedHeader =
      '2024/9/10 上午 9:51 【致同研究】应用指南汇编提示：会计科目主要账务处理 - 资产类系列 ( 上 )';
    const repeatedFooterBase = 'https://mp.weixin.qq.com/s/JJdlsmkTD3AGKeLVKLLuvA';
    const textPageBody =
      '这是一段真正的正文内容，用于模拟前两页的可提取文本。'.repeat(8);
    const scanLikeTitle = '资产类12及13系列';

    const result = classifyDocument([
      {
        pageNumber: 1,
        text: `${repeatedHeader}\n${repeatedFooterBase} 1/21\n${textPageBody}`,
        charCount: `${repeatedHeader}\n${repeatedFooterBase} 1/21\n${textPageBody}`.trim()
          .length,
      },
      {
        pageNumber: 2,
        text: `${repeatedHeader}\n${repeatedFooterBase} 2/21`,
        charCount: `${repeatedHeader}\n${repeatedFooterBase} 2/21`.trim().length,
      },
      {
        pageNumber: 3,
        text: `${repeatedHeader}\n${repeatedFooterBase} 3/21\n${scanLikeTitle}`,
        charCount: `${repeatedHeader}\n${repeatedFooterBase} 3/21\n${scanLikeTitle}`.trim()
          .length,
      },
    ]);

    expect(result.type).toBe('mixed');
    expect(result.textPageCount).toBe(1);
    expect(result.scanPageCount).toBe(2);
    expect(result.pages.map((page) => page.type)).toEqual(['text', 'scan', 'scan']);
    expect(result.pages[1].charCount).toBe(0);
    expect(result.pages[2].charCount).toBeLessThan(100);
  });
});
