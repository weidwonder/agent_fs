import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ConverterClient,
  resolveConverterLaunchTarget,
  resolveExistingPath,
  type ConverterProcess,
} from './converter-client';

function createFakeProcess() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const emitter = new EventEmitter();

  const process = Object.assign(emitter, {
    stdout,
    stdin,
    kill: vi.fn(),
  });

  return { process: process as ConverterProcess, stdout, stdin };
}

describe('ConverterClient', () => {
  it('应优先将 app.asar 路径解析到 app.asar.unpacked', () => {
    const tempRoot = join(
      tmpdir(),
      `excel-client-path-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const unpackedPath = join(
      tempRoot,
      'Agent FS.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      '@agent-fs',
      'plugin-excel',
      'dist',
      'dotnet',
      'ExcelConverter.dll',
    );
    mkdirSync(join(unpackedPath, '..'), { recursive: true });
    writeFileSync(unpackedPath, '');

    const asarPath = unpackedPath.replace('app.asar.unpacked', 'app.asar');
    expect(resolveExistingPath(asarPath)).toBe(unpackedPath);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('仅存在发布可执行文件时也应将 dll 路径解析到可执行文件', () => {
    const tempRoot = join(
      tmpdir(),
      `excel-client-executable-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const executablePath = join(tempRoot, 'ExcelConverter');
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(executablePath, '');

    expect(resolveExistingPath(`${executablePath}.dll`)).toBe(executablePath);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('存在发布可执行文件时应直接执行可执行文件', () => {
    const tempRoot = join(
      tmpdir(),
      `excel-client-launch-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const executablePath = join(tempRoot, 'ExcelConverter');
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(executablePath, '');

    const target = resolveConverterLaunchTarget(`${executablePath}.dll`);
    expect(target).toEqual({
      command: executablePath,
      args: [],
      path: executablePath,
    });

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('本地开发回退到 csproj 时应通过 dotnet run 启动', () => {
    const tempRoot = join(
      tmpdir(),
      `excel-client-csproj-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const projectPath = join(tempRoot, 'ExcelConverter.csproj');
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(projectPath, '');

    const target = resolveConverterLaunchTarget(projectPath);
    expect(target).toEqual({
      command: 'dotnet',
      args: ['run', '--project', projectPath],
      path: projectPath,
    });

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('start 应按解析后的启动目标启动并完成 ping', async () => {
    const tempRoot = join(
      tmpdir(),
      `excel-client-start-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const executablePath = join(tempRoot, 'ExcelConverter');
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(executablePath, '');

    const { process, stdout, stdin } = createFakeProcess();
    const spawnFn = vi.fn().mockReturnValue(process);
    const client = new ConverterClient({
      dotnetPath: `${executablePath}.dll`,
      spawnFn,
    });

    stdin.on('data', (chunk) => {
      const request = JSON.parse(chunk.toString().trim()) as { id: number; method: string };
      if (request.method === 'ping') {
        stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: { status: 'ok' },
          }) + '\n',
        );
      }
    });

    await client.start();
    expect(spawnFn).toHaveBeenCalledWith(executablePath, []);

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
