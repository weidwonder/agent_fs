import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('应在 1.0 registry 格式时直接重置为空 2.0', async () => {
    const { Indexer } = await import('./indexer');
    const indexer = new Indexer() as any;

    const normalized = indexer.parseRegistryOrEmpty({
      version: '1.0',
      embeddingModel: 'embedding-2',
      embeddingDimension: 512,
      indexedDirectories: [
        {
          path: '/tmp/demo',
          alias: 'demo',
          dirId: 'dir-123',
          summary: '旧摘要',
          lastUpdated: '2026-01-01T00:00:00.000Z',
          fileCount: 3,
          chunkCount: 20,
          valid: true,
        },
      ],
    });

    expect(normalized.version).toBe('2.0');
    expect(Array.isArray(normalized.projects)).toBe(true);
    expect(normalized.projects).toHaveLength(0);
  });

  it('应在 registry 非法时回退到空 2.0', async () => {
    const { Indexer } = await import('./indexer');
    const indexer = new Indexer() as any;

    const normalized = indexer.parseRegistryOrEmpty({
      version: 'legacy',
      data: [],
    });

    expect(normalized.version).toBe('2.0');
    expect(Array.isArray(normalized.projects)).toBe(true);
    expect(normalized.projects).toHaveLength(0);
  });

  it('应在首次索引后生成 memory/project.md 和 extend 目录', async () => {
    const { Indexer } = await import('./indexer');
    const indexer = new Indexer() as any;
    const projectDir = mkdtempSync(join(tmpdir(), 'agent-fs-indexer-memory-'));

    try {
      const projectMdPath = join(projectDir, '.fs_index', 'memory', 'project.md');
      const extendPath = join(projectDir, '.fs_index', 'memory', 'extend');
      expect(existsSync(projectMdPath)).toBe(false);

      indexer.initMemoryIfNeeded(projectDir, {
        directoryPath: projectDir,
        directorySummary: '这是目录摘要',
      });

      expect(existsSync(projectMdPath)).toBe(true);
      expect(existsSync(extendPath)).toBe(true);

      const projectMd = readFileSync(projectMdPath, 'utf-8');
      expect(projectMd).toContain('这是目录摘要');
      expect(projectMd).toContain('#');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
