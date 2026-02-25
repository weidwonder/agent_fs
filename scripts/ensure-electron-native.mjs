import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const electronAppDir = join(repoRoot, 'packages', 'electron-app');
const pnpmDir = join(repoRoot, 'node_modules', '.pnpm');
const signatureMismatchText = 'code signature does not cover entire file up to signature';

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf-8',
    ...options,
  });
}

function collectNativeBinaryPaths() {
  if (!existsSync(pnpmDir)) {
    return [];
  }

  const targets = [
    {
      prefix: 'better-sqlite3@',
      pathParts: ['node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'],
    },
    {
      prefix: 'nodejieba@',
      pathParts: ['node_modules', 'nodejieba', 'build', 'Release', 'nodejieba.node'],
    },
  ];

  const result = [];
  for (const entry of readdirSync(pnpmDir)) {
    for (const target of targets) {
      if (!entry.startsWith(target.prefix)) {
        continue;
      }
      const binaryPath = join(pnpmDir, entry, ...target.pathParts);
      if (existsSync(binaryPath)) {
        result.push(binaryPath);
      }
    }
  }

  return Array.from(new Set(result)).sort();
}

function probeElectronNativeModules() {
  const probeScript = `
try {
  const BetterSqlite3 = require('better-sqlite3');
  const db = new BetterSqlite3(':memory:');
  db.prepare('SELECT 1 AS ok').get();
  db.close();
  const nodejieba = require('nodejieba');
  nodejieba.cut('Agent FS native probe');
  process.stdout.write('electron-native-probe-ok\\n');
} catch (error) {
  process.stderr.write(String(error?.stack || error));
  process.stderr.write('\\n');
  process.exit(1);
}
`;

  return run('pnpm', ['exec', 'electron', '-e', probeScript], {
    cwd: electronAppDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  });
}

function repairCodeSign(binaryPath) {
  run('codesign', ['--remove-signature', binaryPath]);
  const signResult = run('codesign', ['--force', '--sign', '-', binaryPath]);
  if (signResult.status !== 0) {
    process.stderr.write(signResult.stderr || signResult.stdout || '');
    throw new Error(`重签名失败: ${binaryPath}`);
  }
}

function repairDarwinSignatures() {
  const binaryPaths = collectNativeBinaryPaths();
  if (binaryPaths.length === 0) {
    console.warn('⚠️ 未发现可修复的 native 二进制。');
    return;
  }

  console.log('🛠️ 检测到签名异常，开始修复 native 模块签名...');
  for (const binaryPath of binaryPaths) {
    repairCodeSign(binaryPath);
    console.log(`✅ 已重签名: ${binaryPath}`);
  }
}

function printProbeOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function main() {
  const firstProbe = probeElectronNativeModules();
  if (firstProbe.status === 0) {
    printProbeOutput(firstProbe);
    return;
  }

  printProbeOutput(firstProbe);
  const combinedOutput = `${firstProbe.stdout ?? ''}\n${firstProbe.stderr ?? ''}`;
  const isDarwinSignatureIssue = process.platform === 'darwin'
    && combinedOutput.includes(signatureMismatchText);

  if (!isDarwinSignatureIssue) {
    process.exit(firstProbe.status ?? 1);
  }

  repairDarwinSignatures();

  const secondProbe = probeElectronNativeModules();
  printProbeOutput(secondProbe);
  if (secondProbe.status !== 0) {
    process.exit(secondProbe.status ?? 1);
  }
}

main();
