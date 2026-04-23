import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  listLeaves,
  removeLeavesByFileId as removeClueLeavesByFileId,
  type Clue,
  type ClueSummary,
} from '@agent-fs/core';
import type { ClueAdapter } from '../types.js';
import {
  deleteClue as deleteStoredClue,
  readClue as readStoredClue,
  readClueRegistry,
  readRegistry,
  sortClueSummaries,
  writeClue as writeStoredClue,
  writeClueRegistry,
} from './local-clue-files.js';

export class LocalClueAdapter implements ClueAdapter {
  private readonly registryPath: string;

  constructor(options: { registryPath?: string }) {
    this.registryPath = options.registryPath ?? join(homedir(), '.agent_fs', 'registry.json');
  }

  async init(): Promise<void> {}

  async listClues(projectId: string): Promise<ClueSummary[]> {
    const projectPath = this.resolveProjectPath(projectId);
    return readClueRegistry(projectPath).clues;
  }

  async getClue(clueId: string): Promise<Clue | null> {
    const location = this.findClueLocation(clueId);
    if (!location) return null;
    return readStoredClue(location.projectPath, clueId);
  }

  async saveClue(clue: Clue): Promise<void> {
    const projectPath = this.resolveProjectPath(clue.projectId);
    const registry = readClueRegistry(projectPath);
    const duplicated = registry.clues.find(
      (item) => item.id !== clue.id && item.name === clue.name
    );
    if (duplicated) {
      throw new Error(`Clue 名称已存在: ${clue.name}`);
    }

    writeStoredClue(projectPath, clue);

    const summary: ClueSummary = {
      id: clue.id,
      name: clue.name,
      description: clue.description,
      updatedAt: clue.updatedAt,
      leafCount: listLeaves(clue).length,
    };
    const nextClues = registry.clues.filter((item) => item.id !== clue.id);
    nextClues.push(summary);
    writeClueRegistry(projectPath, { clues: sortClueSummaries(nextClues) });
  }

  async deleteClue(clueId: string): Promise<void> {
    const location = this.findClueLocation(clueId);
    if (!location) return;

    deleteStoredClue(location.projectPath, clueId);
    const registry = readClueRegistry(location.projectPath);
    writeClueRegistry(location.projectPath, {
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
    const registry = readClueRegistry(projectPath);
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
      writeStoredClue(projectPath, result.clue);
      nextClues[index] = {
        ...summary,
        updatedAt: result.clue.updatedAt,
        leafCount: listLeaves(result.clue).length,
      };
    }

    if (changed) {
      writeClueRegistry(projectPath, { clues: sortClueSummaries(nextClues) });
    }

    return {
      affectedClues,
      removedLeaves,
      removedFolders,
    };
  }

  async close(): Promise<void> {}

  private resolveProjectPath(projectId: string): string {
    const registry = readRegistry(this.registryPath);
    const project = registry.projects.find((item) => item.valid && item.projectId === projectId);
    if (!project) {
      throw new Error(`项目不存在或未注册: ${projectId}`);
    }
    return project.path;
  }

  private findClueLocation(clueId: string): { projectPath: string } | null {
    const registry = readRegistry(this.registryPath);
    for (const project of registry.projects) {
      if (!project.valid) continue;
      const clueRegistry = readClueRegistry(project.path);
      if (clueRegistry.clues.some((item) => item.id === clueId)) {
        return { projectPath: project.path };
      }
    }
    return null;
  }
}
