import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  listLeaves,
  removeLeavesByFileId as removeClueLeavesByFileId,
  type Clue,
  type ClueSummary,
  type Registry,
} from '@agent-fs/core';
import type { ClueAdapter } from '../types.js';

interface ClueRegistryFile {
  clues: ClueSummary[];
}

export class LocalClueAdapter implements ClueAdapter {
  private readonly registryPath: string;

  constructor(options: { registryPath?: string }) {
    this.registryPath = options.registryPath ?? join(homedir(), '.agent_fs', 'registry.json');
  }

  async init(): Promise<void> {}

  async listClues(projectId: string): Promise<ClueSummary[]> {
    const projectPath = this.resolveProjectPath(projectId);
    return this.readClueRegistry(projectPath).clues;
  }

  async getClue(clueId: string): Promise<Clue | null> {
    const location = this.findClueLocation(clueId);
    if (!location) return null;

    try {
      return JSON.parse(readFileSync(this.cluePath(location.projectPath, clueId), 'utf-8')) as Clue;
    } catch {
      return null;
    }
  }

  async saveClue(clue: Clue): Promise<void> {
    const projectPath = this.resolveProjectPath(clue.projectId);
    const registry = this.readClueRegistry(projectPath);
    const duplicated = registry.clues.find(
      (item) => item.id !== clue.id && item.name === clue.name
    );
    if (duplicated) {
      throw new Error(`Clue 名称已存在: ${clue.name}`);
    }

    this.ensureClueDir(projectPath);
    writeFileSync(this.cluePath(projectPath, clue.id), JSON.stringify(clue, null, 2));

    const summary: ClueSummary = {
      id: clue.id,
      name: clue.name,
      description: clue.description,
      updatedAt: clue.updatedAt,
      leafCount: listLeaves(clue).length,
    };
    const nextClues = registry.clues.filter((item) => item.id !== clue.id);
    nextClues.push(summary);
    this.writeClueRegistry(projectPath, { clues: sortByName(nextClues) });
  }

  async deleteClue(clueId: string): Promise<void> {
    const location = this.findClueLocation(clueId);
    if (!location) return;

    const filePath = this.cluePath(location.projectPath, clueId);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }

    const registry = this.readClueRegistry(location.projectPath);
    this.writeClueRegistry(location.projectPath, {
      clues: registry.clues.filter((item) => item.id !== clueId),
    });
  }

  async removeLeavesByFileId(
    projectId: string,
    fileId: string
  ): Promise<{
    affectedClues: string[];
    removedLeaves: number;
    removedFolders: number;
  }> {
    const projectPath = this.resolveProjectPath(projectId);
    const registry = this.readClueRegistry(projectPath);
    const nextClues = [...registry.clues];
    const affectedClues: string[] = [];
    let removedLeaves = 0;
    let removedFolders = 0;
    let changed = false;

    for (const [index, summary] of nextClues.entries()) {
      const clue = await this.getClue(summary.id);
      if (!clue) {
        continue;
      }

      const result = removeClueLeavesByFileId(clue, fileId);
      if (result.removedLeaves === 0) {
        continue;
      }

      changed = true;
      affectedClues.push(clue.id);
      removedLeaves += result.removedLeaves;
      removedFolders += result.removedFolders;
      writeFileSync(this.cluePath(projectPath, clue.id), JSON.stringify(result.clue, null, 2));
      nextClues[index] = {
        ...summary,
        updatedAt: result.clue.updatedAt,
        leafCount: listLeaves(result.clue).length,
      };
    }

    if (changed) {
      this.writeClueRegistry(projectPath, { clues: sortByName(nextClues) });
    }

    return {
      affectedClues,
      removedLeaves,
      removedFolders,
    };
  }

  async close(): Promise<void> {}

  private resolveProjectPath(projectId: string): string {
    const registry = this.readRegistry();
    const project = registry.projects.find((item) => item.valid && item.projectId === projectId);
    if (!project) {
      throw new Error(`项目不存在或未注册: ${projectId}`);
    }
    return project.path;
  }

  private findClueLocation(clueId: string): { projectPath: string } | null {
    const registry = this.readRegistry();
    for (const project of registry.projects) {
      if (!project.valid) continue;
      const clueRegistry = this.readClueRegistry(project.path);
      if (clueRegistry.clues.some((item) => item.id === clueId)) {
        return { projectPath: project.path };
      }
    }
    return null;
  }

  private readRegistry(): Registry {
    if (!existsSync(this.registryPath)) {
      return { version: '2.0', embeddingModel: '', embeddingDimension: 0, projects: [] };
    }

    const registry = JSON.parse(readFileSync(this.registryPath, 'utf-8')) as Registry;
    if (!Array.isArray(registry.projects)) {
      throw new Error('registry.json 不是 2.0 格式，请删除后重新索引');
    }
    return registry;
  }

  private readClueRegistry(projectPath: string): ClueRegistryFile {
    const registryPath = join(this.clueDir(projectPath), 'registry.json');
    if (!existsSync(registryPath)) {
      return { clues: [] };
    }

    try {
      const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as ClueRegistryFile;
      return { clues: Array.isArray(parsed.clues) ? parsed.clues : [] };
    } catch {
      return { clues: [] };
    }
  }

  private writeClueRegistry(projectPath: string, registry: ClueRegistryFile): void {
    this.ensureClueDir(projectPath);
    writeFileSync(
      join(this.clueDir(projectPath), 'registry.json'),
      JSON.stringify(registry, null, 2)
    );
  }

  private ensureClueDir(projectPath: string): void {
    mkdirSync(this.clueDir(projectPath), { recursive: true });
  }

  private clueDir(projectPath: string): string {
    return join(projectPath, '.fs_index', 'clues');
  }

  private cluePath(projectPath: string, clueId: string): string {
    return join(this.clueDir(projectPath), `${clueId}.json`);
  }
}

function sortByName(clues: ClueSummary[]): ClueSummary[] {
  return [...clues].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}
