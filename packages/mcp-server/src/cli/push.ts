import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FileMetadata, IndexMetadata, Registry, VectorDocument } from '@agent-fs/core';
import { MarkdownChunker } from '@agent-fs/core';
import { createAFDStorage } from '@agent-fs/storage';
import { createLocalAdapter, type StorageAdapter } from '@agent-fs/storage-adapter';
import { getCredential, normalizeTarget } from './credentials.js';

const REEMBED_CHUNKER = new MarkdownChunker({ minTokens: 200, maxTokens: 400 });

interface CollectedFile {
  dirPath: string;
  dirRelativePath: string;
  file: FileMetadata;
}

export async function pushCommand(target: string, projectId: string, localPath?: string): Promise<void> {
  const normalizedTarget = normalizeTarget(target);
  const projectPath = resolve(localPath ?? process.cwd());
  if (!existsSync(join(projectPath, '.fs_index', 'index.json'))) {
    console.error(`错误: ${projectPath} 不是已索引的 Project（未找到 .fs_index/index.json）`);
    process.exit(1);
  }

  const credential = getCredential(normalizedTarget);
  if (!credential) {
    console.error(`错误: 未登录到 ${normalizedTarget}，请先运行: agent-fs login --target ${normalizedTarget}`);
    process.exit(1);
  }

  const registry = readRegistry();
  if (!registry) {
    console.error('错误: 未找到 ~/.agent_fs/registry.json，无法读取本地 embedding 信息');
    process.exit(1);
  }

  const cloudEmbedding = await fetchJson<{ model: string; dimension: number }>(
    `${normalizedTarget}/api/projects/${projectId}/embedding-info`,
    credential.accessToken,
  );
  const embeddingMatch =
    registry.embeddingModel === cloudEmbedding.model &&
    registry.embeddingDimension === cloudEmbedding.dimension;

  if (embeddingMatch) {
    console.log(`Embedding 模型一致 (${registry.embeddingModel})，将直接迁移向量`);
  } else {
    console.log(
      `Embedding 模型不一致（本地: ${registry.embeddingModel}/${registry.embeddingDimension}, 云端: ${cloudEmbedding.model}/${cloudEmbedding.dimension}），云端将重新生成向量`,
    );
  }

  const localAdapter = createLocalAdapter({
    storagePath: join(homedir(), '.agent_fs', 'storage'),
    dimension: registry.embeddingDimension,
  });
  await localAdapter.init();

  try {
    const allFiles = collectFiles(projectPath);
    const total = allFiles.length;
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (let index = 0; index < allFiles.length; index += 1) {
      const file = allFiles[index];
      const label = `[${String(index + 1).padStart(String(total).length)}/${total}]`;

      try {
        const body = await buildImportBody(file, localAdapter, embeddingMatch);
        const response = await fetch(`${normalizedTarget}/api/projects/${projectId}/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credential.accessToken}`,
          },
          body: JSON.stringify(body),
        });

        if (response.status === 409) {
          console.log(`${label} ${file.file.name} ⊘ 已存在，跳过`);
          skipped += 1;
        } else if (!response.ok) {
          console.error(`${label} ${file.file.name} ✗ ${await response.text()}`);
          failed += 1;
        } else {
          console.log(`${label} ${file.file.name} ✓`);
          success += 1;
        }
      } catch (error) {
        console.error(`${label} ${file.file.name} ✗ ${error instanceof Error ? error.message : error}`);
        failed += 1;
      }
    }

    console.log(`\n推送完成：${total} 个文件`);
    console.log(`  成功：${success}`);
    if (skipped > 0) console.log(`  跳过（已存在）：${skipped}`);
    if (failed > 0) console.log(`  失败：${failed}`);
  } finally {
    await localAdapter.close();
  }
}

function collectFiles(projectPath: string): CollectedFile[] {
  const files: CollectedFile[] = [];
  collectFilesRecursive(projectPath, '.', files);
  return files;
}

function collectFilesRecursive(projectPath: string, relativePath: string, files: CollectedFile[]): void {
  const dirPath = relativePath === '.' ? projectPath : join(projectPath, relativePath);
  const metadata = readIndexMetadata(dirPath);
  if (!metadata) return;

  for (const file of metadata.files) {
    files.push({ dirPath, dirRelativePath: relativePath, file });
  }

  const entries = readdirSync(dirPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.fs_index') continue;
    const childRelativePath = relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`;
    if (existsSync(join(dirPath, entry.name, '.fs_index', 'index.json'))) {
      collectFilesRecursive(projectPath, childRelativePath, files);
    }
  }
}

async function buildImportBody(
  file: CollectedFile,
  localAdapter: StorageAdapter,
  embeddingMatch: boolean,
): Promise<Record<string, unknown>> {
  const archiveName = file.file.afdName ?? file.file.name ?? file.file.fileId;
  const storage = createAFDStorage({ documentsDir: join(file.dirPath, '.fs_index', 'documents') });
  const contentMd = await storage.readText(archiveName, 'content.md');
  let metadataJson = '{}';
  try {
    metadataJson = await storage.readText(archiveName, 'metadata.json');
  } catch {}

  const chunks = embeddingMatch
    ? await buildChunksFromLocalIndex(file, contentMd, localAdapter).catch(() => buildChunksForReembed(contentMd))
    : buildChunksForReembed(contentMd);

  return {
    fileName: file.file.name,
    dirRelativePath: file.dirRelativePath,
    summary: file.file.summary,
    sizeBytes: file.file.size,
    archive: { 'content.md': contentMd, 'metadata.json': metadataJson },
    chunks,
  };
}

async function buildChunksFromLocalIndex(file: CollectedFile, contentMd: string, localAdapter: StorageAdapter) {
  const chunkIds = Array.from({ length: file.file.chunkCount }, (_, index) => `${file.file.fileId}:${String(index).padStart(4, '0')}`);
  const vectorDocs = await localAdapter.vector.getByChunkIds(chunkIds) as VectorDocument[];
  const vectorMap = new Map(vectorDocs.map((doc) => [doc.chunk_id, doc]));
  return chunkIds.map((chunkId) => {
    const doc = vectorMap.get(chunkId);
    if (!doc) throw new Error(`missing local chunk ${chunkId}`);
    return {
      content: extractChunkContent(contentMd, doc),
      locator: doc.locator,
      lineStart: doc.chunk_line_start,
      lineEnd: doc.chunk_line_end,
      vector: doc.content_vector,
    };
  });
}

function buildChunksForReembed(contentMd: string) {
  return REEMBED_CHUNKER.chunk(contentMd).map((chunk) => ({
    content: chunk.content,
    locator: chunk.locator,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
    vector: null,
  }));
}

function extractChunkContent(contentMd: string, doc: VectorDocument): string {
  const lines = contentMd.split('\n');
  const byLines = lines.slice(Math.max(0, doc.chunk_line_start - 1), Math.min(lines.length, doc.chunk_line_end)).join('\n');
  if (byLines) return byLines;
  const match = /^(?:line|lines):(\d+)(?:-(\d+))?$/u.exec(doc.locator.trim());
  if (!match) return '';
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return lines.slice(Math.max(0, start - 1), Math.min(lines.length, end)).join('\n');
}

function readRegistry(): Registry | null {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(registryPath)) return null;
  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  } catch {
    return null;
  }
}

function readIndexMetadata(dirPath: string): IndexMetadata | null {
  const indexPath = join(dirPath, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8')) as IndexMetadata;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}
