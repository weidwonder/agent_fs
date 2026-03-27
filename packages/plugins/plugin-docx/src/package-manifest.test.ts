import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

interface PackageManifest {
  files?: string[];
  scripts?: Record<string, string>;
}

describe('@agent-fs/plugin-docx package manifest', () => {
  it('应在 build 时生成并发布 dotnet 产物', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
    ) as PackageManifest;

    expect(packageJson.files).toContain('dotnet');
    expect(packageJson.scripts?.build).toContain('build:dotnet');
  });
});
