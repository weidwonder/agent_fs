import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { load as parseYaml, dump as dumpYaml } from 'js-yaml';
import { getDefaultConfigPath } from './loader';
import { resolveEnvVariables } from './env';

export interface RawConfigResult {
  rawConfig: Record<string, unknown>;
  resolvedConfig: Record<string, unknown>;
  envFields: string[];
}

/**
 * 递归对比 raw 和 resolved 对象，找出因环境变量替换而值不同的字段路径
 */
function detectEnvFields(
  raw: unknown,
  resolved: unknown,
  prefix = '',
): string[] {
  const fields: string[] = [];

  // 只有当 raw 和 resolved 都是普通对象时才递归
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    resolved !== null &&
    typeof resolved === 'object' &&
    !Array.isArray(resolved)
  ) {
    const rawObj = raw as Record<string, unknown>;
    const resolvedObj = resolved as Record<string, unknown>;

    for (const key of Object.keys(rawObj)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const rawVal = rawObj[key];
      const resolvedVal = resolvedObj[key];

      if (
        rawVal !== null &&
        typeof rawVal === 'object' &&
        !Array.isArray(rawVal) &&
        resolvedVal !== null &&
        typeof resolvedVal === 'object' &&
        !Array.isArray(resolvedVal)
      ) {
        // 递归进入子对象
        fields.push(...detectEnvFields(rawVal, resolvedVal, fullPath));
      } else if (rawVal !== resolvedVal) {
        // 叶子节点值不同，说明 raw 中含有 ${VAR} 被解析了
        fields.push(fullPath);
      }
    }
  }

  return fields;
}

/**
 * 递归深度合并两个对象
 * - source 中的 undefined 值跳过
 * - source 中的 null 值删除该键
 * - 对象递归合并
 * - 其他类型直接覆盖
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];

    // undefined 跳过
    if (sourceVal === undefined) {
      continue;
    }

    // null 删除该键
    if (sourceVal === null) {
      delete result[key];
      continue;
    }

    const targetVal = result[key];

    // 双方都是普通对象时递归合并
    if (
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal) &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      // 其他类型直接覆盖
      result[key] = sourceVal;
    }
  }

  return result;
}

/**
 * 读取原始配置（不解析环境变量）和解析后的配置
 */
export function readRawConfig(configPath?: string): RawConfigResult {
  const path = configPath ?? getDefaultConfigPath();
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }

  const fileContent = readFileSync(path, 'utf-8');
  const rawConfig = parseYaml(fileContent) as Record<string, unknown>;
  const resolvedConfig = resolveEnvVariables(rawConfig) as Record<string, unknown>;

  // 递归对比 rawConfig 和 resolvedConfig，找出值不同的字段路径（即来自环境变量）
  const envFields = detectEnvFields(rawConfig, resolvedConfig);

  return { rawConfig, resolvedConfig, envFields };
}

/**
 * 保存配置更新
 * - 读取原始 YAML
 * - 深度合并 updates
 * - 保留未修改字段的环境变量引用
 * - 写回文件
 */
export function saveConfig(
  updates: Record<string, unknown>,
  configPath?: string,
): void {
  const path = configPath ?? getDefaultConfigPath();

  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    const content = readFileSync(path, 'utf-8');
    existing = (parseYaml(content) as Record<string, unknown>) ?? {};
  }

  const merged = deepMerge(existing, updates);
  const yaml = dumpYaml(merged, { indent: 2, lineWidth: 120, noRefs: true });
  writeFileSync(path, yaml, 'utf-8');
}
