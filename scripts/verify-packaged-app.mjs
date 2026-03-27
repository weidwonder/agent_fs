import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const appPath = process.argv[2];

if (!appPath) {
  console.error('用法: node scripts/verify-packaged-app.mjs <Agent FS.app 路径>');
  process.exit(1);
}

const resourcesPath = join(appPath, 'Contents', 'Resources');
const asarPath = join(resourcesPath, 'app.asar');
const unpackedPath = join(resourcesPath, 'app.asar.unpacked');
process.resourcesPath = resourcesPath;

assertExists(asarPath, `缺少 app.asar: ${asarPath}`);
assertContainsApacheArrow(asarPath);

const docxExecutable = join(
  resourcesPath,
  'converters',
  'docx',
  'DocxConverter',
);
const docxDll = join(
  resourcesPath,
  'converters',
  'docx',
  'DocxConverter.dll',
);
const excelClientModule = join(
  unpackedPath,
  'node_modules',
  '@agent-fs',
  'indexer',
  'node_modules',
  '@agent-fs',
  'plugin-excel',
  'dist',
  'converter-client.js',
);
const excelExecutable = join(
  resourcesPath,
  'converters',
  'excel',
  'ExcelConverter',
);

assertExists(docxExecutable, `缺少 DocxConverter 可执行文件: ${docxExecutable}`);
assertExists(docxDll, `缺少 DocxConverter.dll: ${docxDll}`);
assertExists(excelExecutable, `缺少 ExcelConverter 可执行文件: ${excelExecutable}`);
assertExists(excelClientModule, `缺少 Excel ConverterClient 模块: ${excelClientModule}`);

await verifyDocxShutdown(docxExecutable);
await verifyExcelPing(excelExecutable);
await verifyPackagedExcelClient(excelClientModule);

console.log('packaged-app-verify-ok');

function assertExists(targetPath, message) {
  if (!existsSync(targetPath)) {
    console.error(message);
    process.exit(1);
  }
}

function assertContainsApacheArrow(targetAsarPath) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'asar', 'list', targetAsarPath],
    {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || '读取 app.asar 失败');
    process.exit(result.status ?? 1);
  }

  if (!result.stdout.includes('apache-arrow')) {
    console.error('打包产物缺少 apache-arrow');
    process.exit(1);
  }
}

async function verifyPackagedExcelClient(modulePath) {
  const { ConverterClient } = await import(pathToFileURL(modulePath).href);
  const client = new ConverterClient();
  try {
    await client.start();
  } finally {
    await client.stop();
  }
}

function verifyDocxShutdown(executablePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (!stdout.includes('\n')) {
        return;
      }

      const line = stdout.split('\n').find((item) => item.trim().length > 0) ?? '';
      try {
        const response = JSON.parse(line);
        if (response.id === 'smoke-shutdown' && response.success === true) {
          child.kill();
          resolve();
          return;
        }
      } catch {
        // ignore
      }

      reject(new Error(`DocxConverter 响应异常: ${line}`));
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (stdout.includes('"id":"smoke-shutdown"')) {
        return;
      }
      reject(new Error(`DocxConverter 提前退出 code=${code} stderr=${stderr}`));
    });

    child.stdin.write(
      JSON.stringify({
        id: 'smoke-shutdown',
        method: 'shutdown',
      }) + '\n',
    );
  });
}

function verifyExcelPing(executablePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let pingOk = false;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        let response;
        try {
          response = JSON.parse(line);
        } catch {
          reject(new Error(`ExcelConverter 响应异常: ${line}`));
          return;
        }

        if (response.id === 1 && response.result?.status === 'ok') {
          pingOk = true;
          child.stdin.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'shutdown',
              params: {},
            }) + '\n',
          );
          continue;
        }

        if (response.id === 2 && pingOk) {
          child.kill();
          resolve();
          return;
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (pingOk) {
        return;
      }
      reject(new Error(`ExcelConverter 提前退出 code=${code} stderr=${stderr}`));
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: {},
      }) + '\n',
    );
  });
}
