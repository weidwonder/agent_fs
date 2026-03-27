import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

interface PackageManifest {
  dependencies?: Record<string, string>;
}

describe('@agent-fs/search package manifest', () => {
  it('应显式声明 apache-arrow 运行时依赖', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
    ) as PackageManifest;

    expect(packageJson.dependencies?.['apache-arrow']).toBeDefined();
  });
});
