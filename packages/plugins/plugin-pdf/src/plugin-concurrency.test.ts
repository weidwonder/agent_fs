import { beforeEach, describe, expect, it, vi } from 'vitest';

const callOrder: string[] = [];
const releaseQueue: Array<() => void> = [];
const mockExtractTextPerPage = vi.fn();

const mockConvertPDFWithMinerU = vi.fn((filePath: string) => {
  callOrder.push(filePath);
  return new Promise((resolve) => {
    releaseQueue.push(() => {
      resolve({
        markdown: `# ${filePath}`,
        contentList: [{ page_idx: 0, text: filePath }],
        totalPages: 1,
      });
    });
  });
});

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

describe('PDFPlugin MinerU 并发控制', () => {
  beforeEach(() => {
    callOrder.length = 0;
    releaseQueue.length = 0;
    mockExtractTextPerPage.mockReset();
    mockConvertPDFWithMinerU.mockClear();
    mockExtractTextPerPage.mockResolvedValue([
      { pageNumber: 1, text: '', charCount: 0 },
    ]);
  });

  it('仅 MinerU 路径应串行执行多次 toMarkdown 调用', async () => {
    const { PDFPlugin } = await import('./plugin');
    const plugin = new PDFPlugin({
      minerU: {
        serverUrl: 'http://127.0.0.1:30000',
      },
    });

    const firstTask = plugin.toMarkdown('/tmp/a.pdf');
    const secondTask = plugin.toMarkdown('/tmp/b.pdf');

    await flushMicrotasks();
    expect(callOrder).toEqual(['/tmp/a.pdf']);
    expect(mockConvertPDFWithMinerU).toHaveBeenCalledTimes(1);

    releaseQueue.shift()?.();
    await firstTask;
    await flushMicrotasks();
    expect(callOrder).toEqual(['/tmp/a.pdf', '/tmp/b.pdf']);
    expect(mockConvertPDFWithMinerU).toHaveBeenCalledTimes(2);

    releaseQueue.shift()?.();
    await secondTask;
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
