import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const args = new Set(process.argv.slice(2));
const fixMode = args.has('--fix');

function getExpectedArchLabel(arch) {
  if (arch === 'x64') return 'x86_64';
  return arch;
}

function readSysctlValue(name) {
  try {
    return execFileSync('sysctl', ['-n', name], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function isAppleSiliconHost() {
  const value = readSysctlValue('hw.optional.arm64');
  return value === '1';
}

function assertRuntimeArchConsistency() {
  if (process.platform !== 'darwin') {
    return;
  }

  if (isAppleSiliconHost() && process.arch !== 'arm64') {
    console.error('❌ 当前是 Apple Silicon 机器，但 Node 运行在 x64 模式。');
    console.error(`   当前 Node: ${process.execPath}`);
    console.error('   请切换到 arm64 Node（例如 /opt/homebrew/opt/node@20/bin/node）后重试。');
    process.exit(1);
  }
}

function collectNodejiebaBinaryPaths() {
  const pnpmDir = join(repoRoot, 'node_modules', '.pnpm');
  const result = [];

  if (!existsSync(pnpmDir)) {
    return result;
  }

  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith('nodejieba@')) {
      continue;
    }
    const binaryPath = join(
      pnpmDir,
      entry,
      'node_modules',
      'nodejieba',
      'build',
      'Release',
      'nodejieba.node'
    );
    if (existsSync(binaryPath)) {
      result.push(binaryPath);
    }
  }

  return Array.from(new Set(result)).sort();
}

function inspectBinary(binaryPath) {
  const output = execFileSync('file', [binaryPath], { encoding: 'utf-8' }).trim();
  return output;
}

function checkNodejiebaBinaries() {
  const expectedLabel = getExpectedArchLabel(process.arch);
  const binaryPaths = collectNodejiebaBinaryPaths();

  if (binaryPaths.length === 0) {
    console.warn('⚠️ 未找到 nodejieba native 二进制，跳过检查。');
    return { mismatches: [] };
  }

  const mismatches = [];
  console.log(`🔍 目标架构: ${process.arch} (${expectedLabel})`);

  for (const binaryPath of binaryPaths) {
    const info = inspectBinary(binaryPath);
    const matched = info.includes(expectedLabel);
    const status = matched ? '✅' : '❌';
    console.log(`${status} ${binaryPath}`);
    if (!matched) {
      console.log(`   ${info}`);
      mismatches.push({ binaryPath, info });
    }
  }

  return { mismatches };
}

function rebuildNodejiebaFromSource() {
  console.log('🛠️ 发现架构不一致，开始源码重建 nodejieba...');
  const result = spawnSync('pnpm', ['rebuild', 'nodejieba'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_build_from_source: 'true',
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  assertRuntimeArchConsistency();

  const firstCheck = checkNodejiebaBinaries();
  if (firstCheck.mismatches.length === 0) {
    console.log('✅ nodejieba native 架构检查通过。');
    return;
  }

  if (!fixMode) {
    console.error('❌ 检查到 nodejieba native 架构不一致，请执行: pnpm native:sync');
    process.exit(1);
  }

  rebuildNodejiebaFromSource();

  const secondCheck = checkNodejiebaBinaries();
  if (secondCheck.mismatches.length > 0) {
    console.error('❌ 自动修复后仍存在架构不一致，请手动排查 pnpm store。');
    process.exit(1);
  }

  console.log('✅ nodejieba native 架构已自动统一。');
}

main();
