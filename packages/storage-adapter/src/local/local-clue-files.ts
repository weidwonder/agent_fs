import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clue, ClueSummary, Registry } from '@agent-fs/core';

export interface ClueRegistryFile {
  clues: ClueSummary[];
}

export function readRegistry(registryPath: string): Registry {
  if (!existsSync(registryPath)) {
    return { version: '2.0', embeddingModel: '', embeddingDimension: 0, projects: [] };
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  if (!Array.isArray(registry.projects)) {
    throw new Error('registry.json 不是 2.0 格式，请删除后重新索引');
  }
  return registry;
}

export function readClue(projectPath: string, clueId: string): Clue | null {
  try {
    return JSON.parse(readFileSync(getCluePath(projectPath, clueId), 'utf-8')) as Clue;
  } catch {
    return null;
  }
}

export function writeClue(projectPath: string, clue: Clue): void {
  ensureClueDir(projectPath);
  writeFileSync(getCluePath(projectPath, clue.id), JSON.stringify(clue, null, 2));
}

export function deleteClue(projectPath: string, clueId: string): void {
  const filePath = getCluePath(projectPath, clueId);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

export function readClueRegistry(projectPath: string): ClueRegistryFile {
  const registryPath = join(getClueDir(projectPath), 'registry.json');
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

export function writeClueRegistry(projectPath: string, registry: ClueRegistryFile): void {
  ensureClueDir(projectPath);
  writeFileSync(join(getClueDir(projectPath), 'registry.json'), JSON.stringify(registry, null, 2));
}

export function sortClueSummaries(clues: ClueSummary[]): ClueSummary[] {
  return [...clues].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function getCluePath(projectPath: string, clueId: string): string {
  return join(getClueDir(projectPath), `${clueId}.json`);
}

function ensureClueDir(projectPath: string): void {
  mkdirSync(getClueDir(projectPath), { recursive: true });
}

function getClueDir(projectPath: string): string {
  return join(projectPath, '.fs_index', 'clues');
}
