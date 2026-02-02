import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * 加载 .env 文件
 * 优先级：当前目录 > ~/.agent_fs/.env
 */
export function loadEnvFiles(): void {
  const globalEnvPath = join(homedir(), '.agent_fs', '.env');
  if (existsSync(globalEnvPath)) {
    loadDotenv({ path: globalEnvPath });
  }

  // 当前目录覆盖全局配置
  loadDotenv({ override: true });
}

/**
 * 替换配置中的环境变量占位符
 * 支持 ${VAR_NAME} 格式
 */
export function resolveEnvVariables(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveEnvString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVariables);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVariables(value);
    }
    return result;
  }

  return obj;
}

function resolveEnvString(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable not found: ${varName}`);
    }
    return value;
  });
}
