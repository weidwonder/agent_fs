import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

/**
 * MinerU 转换结果
 */
export interface MinerUResult {
  /** Markdown 内容 */
  markdown: string;
  /** content_list_v2.json 内容（按页组织的内容块） */
  contentList?: MinerUContentList;
}

/**
 * MinerU 内容块（content_list_v2.json 中的元素）
 */
export interface MinerUBlock {
  type: 'title' | 'paragraph' | 'table' | 'image';
  content: {
    title_content?: Array<{ type: string; content: string }>;
    paragraph_content?: Array<{ type: string; content: string }>;
    level?: number;
  };
  bbox: [number, number, number, number]; // [x, y, 宽度, 高度]
}

/**
 * MinerU 页面数组类型
 * content_list_v2.json 是一个二维数组: Array<Array<MinerUBlock>>
 */
export type MinerUContentList = MinerUBlock[][];

/**
 * MinerU 配置选项
 */
export interface MinerUOptions {
  /** MinerU API 地址 */
  apiHost: string;
  /** 超时时间（毫秒），默认 120000 */
  timeout?: number;
  /** 是否保留临时文件用于调试 */
  keepTemp?: boolean;
  /** 用户 ID（用于 token 头） */
  userId?: string;
  /** API Key（可选） */
  apiKey?: string;
}

/**
 * 调用 MinerU HTTP API 转换 PDF
 */
export async function convertPDFWithMinerU(
  pdfPath: string,
  options: MinerUOptions,
): Promise<MinerUResult> {
  const timeout = options.timeout ?? 120000;
  const keepTemp = options.keepTemp ?? false;

  // 创建临时目录
  const tempDir = join(tmpdir(), `agent-fs-pdf-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  let zipPath: string | undefined;

  try {
    // 1. 调用 MinerU API
    zipPath = await uploadFileAndDownloadZip(pdfPath, tempDir, options, timeout);

    // 2. 解压 ZIP
    const extractDir = join(tempDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    // 3. 查找输出文件
    const { markdownPath, contentListPath } = findOutputFiles(extractDir);

    // 4. 读取文件
    const markdown = readFileSync(markdownPath, 'utf-8');
    let contentList: MinerUContentList | undefined;

    if (contentListPath && existsSync(contentListPath)) {
      const contentListJson = readFileSync(contentListPath, 'utf-8');
      contentList = JSON.parse(contentListJson) as MinerUContentList;
    }

    return { markdown, contentList };
  } finally {
    // 清理临时文件
    if (!keepTemp) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * 上传文件到 MinerU 并下载 ZIP
 */
async function uploadFileAndDownloadZip(
  pdfPath: string,
  tempDir: string,
  options: MinerUOptions,
  timeout: number,
): Promise<string> {
  const endpoint = `${options.apiHost}/file_parse`;
  const fileBuffer = readFileSync(pdfPath);

  // 构建 FormData（使用 undici 的 fetch + FormData 以确保类型一致）
  const { fetch: undiciFetch, FormData } = await import('undici');
  const formData = new FormData();
  formData.append('return_md', 'true');
  formData.append('response_format_zip', 'true');

  // 创建 Blob 并添加到 FormData
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  formData.append('files', blob, pdfPath.split('/').pop() || 'document.pdf');

  // 发起请求
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await undiciFetch(endpoint, {
      method: 'POST',
      headers: {
        token: options.userId ?? '',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        // FormData 会自动设置正确的 content-type 和 boundary
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 检查响应类型（宽松匹配，允许 charset 等参数）
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/zip')) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }

    // 保存 ZIP
    const zipPath = join(tempDir, 'result.zip');
    const arrayBuffer = await response.arrayBuffer();
    writeFileSync(zipPath, Buffer.from(arrayBuffer));

    return zipPath;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 查找解压后的输出文件
 */
function findOutputFiles(extractDir: string): {
  markdownPath: string;
  contentListPath?: string;
} {
  // 查找 vlm 子目录
  const vlmDir = join(extractDir, 'vlm');
  if (!existsSync(vlmDir)) {
    throw new Error('vlm directory not found in extracted files');
  }

  // 读取目录内容
  const files = readdirSync(vlmDir);
  const mdFile = files.find((f: string) => f.endsWith('.md'));

  if (!mdFile) {
    throw new Error('.md file not found in vlm directory');
  }

  const markdownPath = join(vlmDir, mdFile);

  // 查找 content_list_v2.json
  const contentListFile = files.find((f: string) =>
    f.endsWith('_content_list_v2.json'),
  );
  const contentListPath = contentListFile
    ? join(vlmDir, contentListFile)
    : undefined;

  return { markdownPath, contentListPath };
}
