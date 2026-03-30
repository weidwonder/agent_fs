import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import type { IndexMetadata, Registry } from '@agent-fs/core';
import type { MetadataAdapter } from '../types.js';

/**
 * LocalMetadataAdapter
 *
 * Stores index metadata as JSON files under `{metadataDir}/{dirId}.json`.
 * Registry is read from `~/.agent_fs/registry.json`.
 * Project memory is stored under `{metadataDir}/memory/{projectId}/`.
 */
export class LocalMetadataAdapter implements MetadataAdapter {
  private readonly metadataDir: string;
  private readonly registryPath: string;

  constructor(options: { metadataDir: string; registryPath?: string }) {
    this.metadataDir = options.metadataDir;
    this.registryPath =
      options.registryPath ?? join(homedir(), '.agent_fs', 'registry.json');
  }

  async readIndexMetadata(dirId: string): Promise<IndexMetadata | null> {
    const filePath = this.metadataFilePath(dirId);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as IndexMetadata;
    } catch {
      return null;
    }
  }

  async writeIndexMetadata(dirId: string, metadata: IndexMetadata): Promise<void> {
    mkdirSync(this.metadataDir, { recursive: true });
    writeFileSync(this.metadataFilePath(dirId), JSON.stringify(metadata, null, 2));
  }

  async deleteIndexMetadata(dirId: string): Promise<void> {
    const filePath = this.metadataFilePath(dirId);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }

  async listSubdirectories(
    dirId: string,
  ): Promise<{ dirId: string; relativePath: string; summary?: string }[]> {
    const metadata = await this.readIndexMetadata(dirId);
    if (!metadata) {
      return [];
    }
    return metadata.subdirectories.map((sub) => ({
      dirId: sub.dirId,
      relativePath: sub.name,
      summary: sub.summary ?? undefined,
    }));
  }

  async listProjects(): Promise<
    { projectId: string; name: string; rootDirId: string; summary?: string }[]
  > {
    if (!existsSync(this.registryPath)) {
      return [];
    }
    try {
      const registry = JSON.parse(
        readFileSync(this.registryPath, 'utf-8'),
      ) as Registry;
      if (!Array.isArray(registry.projects)) {
        return [];
      }
      return registry.projects
        .filter((p) => p.valid)
        .map((p) => ({
          projectId: p.projectId,
          name: p.alias || p.path.split('/').pop() || p.projectId,
          rootDirId: p.subdirectories[0]?.dirId ?? p.projectId,
          summary: p.summary,
        }));
    } catch {
      return [];
    }
  }

  async readProjectMemory(projectId: string): Promise<{
    memoryPath: string;
    projectMd: string;
    files: { name: string; size: number }[];
  } | null> {
    const memoryPath = this.memoryDir(projectId);
    if (!existsSync(memoryPath)) {
      return null;
    }
    const projectMdPath = join(memoryPath, 'project.md');
    const projectMd = existsSync(projectMdPath)
      ? readFileSync(projectMdPath, 'utf-8')
      : '';
    const files = this.collectMarkdownFiles(memoryPath);
    return { memoryPath, projectMd, files };
  }

  async writeProjectMemoryFile(
    projectId: string,
    fileName: string,
    content: string,
  ): Promise<void> {
    const memoryPath = this.memoryDir(projectId);
    const fullPath = resolve(memoryPath, fileName);
    if (!this.isSafePath(memoryPath, fullPath)) {
      throw new Error('路径越界');
    }
    mkdirSync(memoryPath, { recursive: true });
    writeFileSync(fullPath, content);
  }

  private metadataFilePath(dirId: string): string {
    return join(this.metadataDir, `${dirId}.json`);
  }

  private memoryDir(projectId: string): string {
    return join(this.metadataDir, 'memory', projectId);
  }

  private isSafePath(baseDir: string, targetPath: string): boolean {
    const normalizedBase = resolve(baseDir);
    const normalizedTarget = resolve(targetPath);
    return (
      normalizedTarget === normalizedBase ||
      normalizedTarget.startsWith(`${normalizedBase}${sep}`)
    );
  }

  private collectMarkdownFiles(
    dirPath: string,
    prefix = '',
  ): { name: string; size: number }[] {
    if (!existsSync(dirPath)) return [];
    const results: { name: string; size: number }[] = [];
    for (const entry of readdirSync(dirPath).sort()) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);
      const relativeName = prefix ? `${prefix}/${entry}` : entry;
      if (stat.isDirectory()) {
        results.push(...this.collectMarkdownFiles(fullPath, relativeName));
      } else if (
        stat.isFile() &&
        (entry.toLowerCase().endsWith('.md') ||
          entry.toLowerCase().endsWith('.markdown'))
      ) {
        results.push({ name: relativeName, size: stat.size });
      }
    }
    return results;
  }
}
