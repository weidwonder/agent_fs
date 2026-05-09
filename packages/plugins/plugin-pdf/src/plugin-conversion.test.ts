import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExtractTextPerPage = vi.fn();
const mockConvertPDFWithMinerU = vi.fn();

vi.mock('./pdf-text-extractor', async () => {
  const actual = await vi.importActual<typeof import('./pdf-text-extractor')>(
    './pdf-text-extractor',
  );
  return {
    ...actual,
    extractTextPerPage: mockExtractTextPerPage,
  };
});

vi.mock('./mineru', () => ({
  convertPDFWithMinerU: mockConvertPDFWithMinerU,
}));

describe('PDFPlugin 文本优先转换', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExtractTextPerPage.mockReset();
    mockConvertPDFWithMinerU.mockReset();
  });

  it('纯文本 PDF 应走直接提取路径', async () => {
    mockExtractTextPerPage.mockResolvedValue([
      {
        pageNumber: 1,
        text: '这是一段足够长的纯文本内容，长度超过一百字符。这是一段足够长的纯文本内容，长度超过一百字符。这是一段足够长的纯文本内容，长度超过一百字符。',
        charCount: 72,
      },
      {
        pageNumber: 2,
        text: '第二页也有足够长的纯文本内容。第二页也有足够长的纯文本内容。第二页也有足够长的纯文本内容。第二页也有足够长的纯文本内容。',
        charCount: 64,
      },
    ]);

    const { PDFPlugin } = await import('./plugin');
    const plugin = new PDFPlugin({
      minerU: { serverUrl: 'http://127.0.0.1:30000' },
      textExtraction: { minTextCharsPerPage: 50 },
    });

    const result = await plugin.toMarkdown('/tmp/text.pdf');

    expect(mockConvertPDFWithMinerU).not.toHaveBeenCalled();
    expect(result.markdown).toContain('这是一段足够长的纯文本内容');
    expect(result.markdown).toContain('<!-- page: 1 -->');
    expect(result.mapping).toHaveLength(2);
  });

  it('纯扫描 PDF 应回退到 MinerU', async () => {
    mockExtractTextPerPage.mockResolvedValue([
      { pageNumber: 1, text: '只有很短的字', charCount: 6 },
      { pageNumber: 2, text: '', charCount: 0 },
    ]);
    mockConvertPDFWithMinerU.mockResolvedValue({
      markdown: '# MinerU 输出',
      contentList: [{ page_idx: 0, text: 'MinerU 第1页' }],
      totalPages: 2,
    });

    const { PDFPlugin } = await import('./plugin');
    const plugin = new PDFPlugin({
      minerU: { serverUrl: 'http://127.0.0.1:30000' },
    });

    const result = await plugin.toMarkdown('/tmp/scan.pdf');

    expect(mockConvertPDFWithMinerU).toHaveBeenCalledTimes(1);
    expect(result.markdown).toContain('MinerU 输出');
  });

  it('混合文档应按页合并直接提取与 MinerU 结果', async () => {
    mockExtractTextPerPage.mockResolvedValue([
      {
        pageNumber: 1,
        text: '第一页是文本页，内容很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多。',
        charCount: 57,
      },
      {
        pageNumber: 2,
        text: '短文本',
        charCount: 3,
      },
      {
        pageNumber: 3,
        text: '第三页仍然是文本页，内容很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多。',
        charCount: 58,
      },
    ]);
    mockConvertPDFWithMinerU.mockResolvedValue({
      markdown: '# 整体 MinerU 输出',
      contentList: [
        { page_idx: 0, text: 'MinerU 第1页' },
        { page_idx: 1, text: 'OCR 第2页内容' },
        { page_idx: 2, text: 'MinerU 第3页' },
      ],
      totalPages: 3,
    });

    const { PDFPlugin } = await import('./plugin');
    const plugin = new PDFPlugin({
      minerU: { serverUrl: 'http://127.0.0.1:30000' },
      textExtraction: { minTextCharsPerPage: 50 },
    });

    const result = await plugin.toMarkdown('/tmp/mixed.pdf');

    expect(mockConvertPDFWithMinerU).toHaveBeenCalledTimes(1);
    expect(result.markdown).toContain('第一页是文本页');
    expect(result.markdown).toContain('OCR 第2页内容');
    expect(result.markdown).toContain('第三页仍然是文本页');
    expect(result.mapping.map((item) => item.originalLocator)).toEqual([
      'page:1',
      'page:2',
      'page:3',
    ]);
  });

  it('无 MinerU 配置但纯文本 PDF 仍可成功', async () => {
    mockExtractTextPerPage.mockResolvedValue([
      {
        pageNumber: 1,
        text: '纯文本内容足够长纯文本内容足够长纯文本内容足够长纯文本内容足够长纯文本内容足够长纯文本内容足够长。',
        charCount: 54,
      },
    ]);

    const { PDFPlugin } = await import('./plugin');
    const plugin = new PDFPlugin({
      textExtraction: { minTextCharsPerPage: 50 },
    });

    const result = await plugin.toMarkdown('/tmp/no-mineru-text.pdf');

    expect(mockConvertPDFWithMinerU).not.toHaveBeenCalled();
    expect(result.markdown).toContain('纯文本内容足够长');
  });

  it('无 MinerU 配置且纯扫描 PDF 时应报清晰错误', async () => {
    mockExtractTextPerPage.mockResolvedValue([
      { pageNumber: 1, text: '', charCount: 0 },
    ]);

    const { PDFPlugin } = await import('./plugin');
    const plugin = new PDFPlugin();

    await expect(plugin.toMarkdown('/tmp/no-mineru-scan.pdf')).rejects.toThrow(
      /检测到扫描件但未配置 MinerU/,
    );
    expect(mockConvertPDFWithMinerU).not.toHaveBeenCalled();
  });

  it('文本提取失败时应回退到 MinerU', async () => {
    mockExtractTextPerPage.mockRejectedValue(new Error('pdfjs 失败'));
    mockConvertPDFWithMinerU.mockResolvedValue({
      markdown: '# MinerU 接管',
      contentList: [{ page_idx: 0, text: 'MinerU 接管' }],
      totalPages: 1,
    });

    const { PDFPlugin } = await import('./plugin');
    const plugin = new PDFPlugin({
      minerU: { serverUrl: 'http://127.0.0.1:30000' },
    });

    const result = await plugin.toMarkdown('/tmp/fallback.pdf');

    expect(mockConvertPDFWithMinerU).toHaveBeenCalledTimes(1);
    expect(result.markdown).toContain('MinerU 接管');
  });
});
