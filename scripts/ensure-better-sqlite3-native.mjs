import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const args = new Set(process.argv.slice(2));
const fixMode = args.has('--fix');
const require = createRequire(import.meta.url);

function buildNodeEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.npm_config_runtime;
  delete env.npm_config_target;
  delete env.npm_config_disturl;
  return env;
}

function resolveBetterSqlite3Dir() {
  try {
    const packageJsonPath = require.resolve('better-sqlite3/package.json', {
      paths: [repoRoot],
    });
    return dirname(packageJsonPath);
  } catch (error) {
    console.error('❌ 未找到 better-sqlite3 安装目录。');
    console.error(String(error));
    process.exit(1);
  }
}

function probeBetterSqlite3() {
  const probeScript = `
try {
  const BetterSqlite3 = require('better-sqlite3');
  const db = new BetterSqlite3(':memory:');
  db.prepare('SELECT 1 AS ok').get();
  db.close();
  process.stdout.write('better-sqlite3-probe-ok\\n');
} catch (error) {
  process.stderr.write(String(error?.stack || error));
  process.stderr.write('\\n');
  process.exit(1);
}
`;

  return spawnSync(process.execPath, ['-e', probeScript], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: buildNodeEnv(),
  });
}

function printProbeOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function repairBetterSqlite3() {
  const betterSqlite3Dir = resolveBetterSqlite3Dir();
  console.log('🛠️ 检测到 better-sqlite3 不是 Node ABI，开始重新安装 Node 版本 native 模块...');
  const result = spawnSync('pnpm', ['run', 'install'], {
    cwd: betterSqlite3Dir,
    stdio: 'inherit',
    env: buildNodeEnv(),
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const firstProbe = probeBetterSqlite3();
  if (firstProbe.status === 0) {
    printProbeOutput(firstProbe);
    console.log('✅ better-sqlite3 Node native 检查通过。');
    return;
  }

  printProbeOutput(firstProbe);

  if (!fixMode) {
    console.error('❌ better-sqlite3 当前不是 Node ABI，请执行: pnpm native:sqlite:sync');
    process.exit(1);
  }

  repairBetterSqlite3();

  const secondProbe = probeBetterSqlite3();
  printProbeOutput(secondProbe);
  if (secondProbe.status !== 0) {
    console.error('❌ better-sqlite3 Node native 自动修复失败。');
    process.exit(secondProbe.status ?? 1);
  }

  console.log('✅ better-sqlite3 Node native 已自动修复。');
}

main();
