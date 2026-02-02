import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { load as parseYaml } from 'js-yaml';
import { loadEnvFiles, resolveEnvVariables } from './env';
import { validateConfig, type ResolvedConfig } from './schema';

/**
 * 配置加载选项
 */
export interface LoadConfigOptions {
  /** 配置文件路径（可选，默认 ~/.agent_fs/config.yaml） */
  configPath?: string;

  /** 是否加载 .env 文件 */
  loadEnv?: boolean;
}

/**
 * 获取默认配置文件路径
 */
export function getDefaultConfigPath(): string {
  return join(homedir(), '.agent_fs', 'config.yaml');
}

/**
 * 加载配置文件
 */
export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const { configPath = getDefaultConfigPath(), loadEnv = true } = options;

  if (loadEnv) {
    loadEnvFiles();
  }

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const fileContent = readFileSync(configPath, 'utf-8');
  const rawConfig = parseYaml(fileContent);
  const resolvedConfig = resolveEnvVariables(rawConfig);

  return validateConfig(resolvedConfig);
}

/**
 * 检查配置文件是否存在
 */
export function configExists(configPath?: string): boolean {
  const path = configPath ?? getDefaultConfigPath();
  return existsSync(path);
}
