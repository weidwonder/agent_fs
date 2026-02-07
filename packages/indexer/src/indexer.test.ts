import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  markdownCtor: vi.fn(),
  pdfCtor: vi.fn(),
  docxCtor: vi.fn(),
  excelCtor: vi.fn(),
}));

vi.mock('@agent-fs/core', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('@agent-fs/plugin-markdown', () => ({
  MarkdownPlugin: class {
    readonly supportedExtensions = ['md', 'markdown'];

    constructor(options?: unknown) {
      mocks.markdownCtor(options);
    }
  },
}));

vi.mock('@agent-fs/plugin-pdf', () => ({
  PDFPlugin: class {
    readonly supportedExtensions = ['pdf'];

    constructor(options?: unknown) {
      mocks.pdfCtor(options);
    }
  },
}));

vi.mock('@agent-fs/plugin-docx', () => ({
  DocxPlugin: class {
    readonly supportedExtensions = ['doc', 'docx'];

    constructor(options?: unknown) {
      mocks.docxCtor(options);
    }
  },
}));

vi.mock('@agent-fs/plugin-excel', () => ({
  ExcelPlugin: class {
    readonly supportedExtensions = ['xls', 'xlsx'];

    constructor(options?: unknown) {
      mocks.excelCtor(options);
    }
  },
}));

describe('Indexer 插件配置注入', () => {
  beforeEach(() => {
    mocks.loadConfig.mockReset();
    mocks.markdownCtor.mockReset();
    mocks.pdfCtor.mockReset();
    mocks.docxCtor.mockReset();
    mocks.excelCtor.mockReset();

    mocks.loadConfig.mockReturnValue({
      llm: {
        provider: 'openai-compatible',
        base_url: 'https://example.com/v1',
        api_key: 'test-key',
        model: 'gpt-4o-mini',
      },
      embedding: {
        default: 'local',
        local: {
          model: 'test-model',
          device: 'cpu',
        },
      },
      indexing: {
        chunk_size: {
          min_tokens: 10,
          max_tokens: 100,
        },
      },
      search: {
        default_top_k: 10,
        fusion: { method: 'rrf' },
      },
      plugins: {
        pdf: {
          minerU: {
            serverUrl: 'http://127.0.0.1:3000',
            timeout: 30000,
          },
        },
        docx: {
          converter: {
            converterPath: '/tmp/docx-converter.dll',
            timeoutMs: 45000,
          },
        },
        excel: {
          converter: {
            dotnetPath: '/tmp/excel-converter.csproj',
          },
        },
      },
    });
  });

  it('应将 plugins 配置注入 PDF/DOCX/Excel 插件构造参数', async () => {
    const { Indexer } = await import('./indexer');
    new Indexer();

    expect(mocks.markdownCtor).toHaveBeenCalledTimes(1);
    expect(mocks.markdownCtor).toHaveBeenCalledWith(undefined);

    expect(mocks.pdfCtor).toHaveBeenCalledTimes(1);
    expect(mocks.pdfCtor).toHaveBeenCalledWith({
      minerU: {
        serverUrl: 'http://127.0.0.1:3000',
        timeout: 30000,
      },
    });

    expect(mocks.docxCtor).toHaveBeenCalledTimes(1);
    expect(mocks.docxCtor).toHaveBeenCalledWith({
      converter: {
        converterPath: '/tmp/docx-converter.dll',
        timeoutMs: 45000,
      },
    });

    expect(mocks.excelCtor).toHaveBeenCalledTimes(1);
    expect(mocks.excelCtor).toHaveBeenCalledWith({
      converter: {
        dotnetPath: '/tmp/excel-converter.csproj',
      },
    });
  });

  it('应兼容 minerU.apiHost 并映射到 serverUrl', async () => {
    mocks.loadConfig.mockReturnValue({
      llm: {
        provider: 'openai-compatible',
        base_url: 'https://example.com/v1',
        api_key: 'test-key',
        model: 'gpt-4o-mini',
      },
      embedding: {
        default: 'local',
        local: {
          model: 'test-model',
          device: 'cpu',
        },
      },
      indexing: {
        chunk_size: {
          min_tokens: 10,
          max_tokens: 100,
        },
      },
      search: {
        default_top_k: 10,
        fusion: { method: 'rrf' },
      },
      plugins: {
        pdf: {
          minerU: {
            apiHost: 'http://127.0.0.1:30000',
            timeout: 30000,
          },
        },
      },
    });

    const { Indexer } = await import('./indexer');
    new Indexer();

    expect(mocks.pdfCtor).toHaveBeenCalledTimes(1);
    expect(mocks.pdfCtor).toHaveBeenCalledWith({
      minerU: {
        serverUrl: 'http://127.0.0.1:30000',
        timeout: 30000,
      },
    });
  });
});
