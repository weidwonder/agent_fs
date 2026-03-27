import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { DocxRequest, DocxResponse, DocxSuccessData } from './protocol';

export interface DocxProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill: (signal?: NodeJS.Signals) => void;
  on: (event: 'exit' | 'close' | 'error', listener: (...args: any[]) => void) => void;
}

export interface DocxServiceOptions {
  converterPath?: string;
  spawnFn?: (command: string, args: string[]) => DocxProcess;
  timeoutMs?: number;
}

interface ConverterLaunchTarget {
  command: string;
  args: string[];
  path: string;
}

type PendingRequest = {
  resolve: (data: DocxSuccessData) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
};

export class DocxService {
  private process: DocxProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private buffer = '';
  private stderrTail = '';
  private spawnFn: (command: string, args: string[]) => DocxProcess;
  private converterPath: string;
  private timeoutMs: number;

  constructor(options: DocxServiceOptions = {}) {
    this.spawnFn = options.spawnFn ?? ((command, args) => spawn(command, args) as DocxProcess);
    this.converterPath = options.converterPath ?? resolveConverterPath();
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async start(): Promise<void> {
    if (this.process) return;

    const launchTarget = resolveConverterLaunchTarget(this.converterPath);
    if (!existsSync(launchTarget.path)) {
      throw new Error(
        `DocxConverter 未找到: ${launchTarget.path}，请先运行 pnpm --filter @agent-fs/plugin-docx build:dotnet`,
      );
    }

    this.process = this.spawnFn(launchTarget.command, launchTarget.args);
    this.process.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    this.process.stderr.on('data', (chunk: Buffer) => {
      const chunkText = chunk.toString('utf8');
      this.stderrTail = `${this.stderrTail}${chunkText}`.trim();
      if (this.stderrTail.length > 1200) {
        this.stderrTail = this.stderrTail.slice(this.stderrTail.length - 1200);
      }
    });
    this.process.on('exit', () => this.rejectAll(new Error('DocxConverter 已退出')));
  }

  async convert(filePath: string): Promise<DocxSuccessData> {
    if (!this.process) {
      await this.start();
    }

    const id = randomUUID();
    const request: DocxRequest = {
      id,
      method: 'convert',
      params: { filePath },
    };

    this.stderrTail = '';
    const payload = JSON.stringify(request) + '\n';
    this.process?.stdin.write(payload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('DocxConverter 请求超时'));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    const request: DocxRequest = {
      id: randomUUID(),
      method: 'shutdown',
    };

    this.process.stdin.write(JSON.stringify(request) + '\n');
    this.process.kill();
    this.process = null;
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let index = this.buffer.indexOf('\n');

    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);

      if (line.length > 0) {
        this.handleResponseLine(line);
      }

      index = this.buffer.indexOf('\n');
    }
  }

  private handleResponseLine(line: string): void {
    let response: DocxResponse;

    try {
      response = JSON.parse(line) as DocxResponse;
    } catch {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;

    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.success) {
      pending.resolve(response.data);
    } else {
      const responseMessage = response.error.message.trim();
      const message = responseMessage || this.stderrTail || '未提供错误详情';
      pending.reject(new Error(`${response.error.code}: ${message}`));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function resolveConverterPath(): string {
  const custom = process.env.AGENT_FS_DOCX_CONVERTER;
  if (custom) return resolveExistingPath(custom);

  const packagedPath = resolvePackagedResourcePath('docx', 'DocxConverter.dll');
  if (packagedPath) return packagedPath;

  const baseDir = dirname(fileURLToPath(import.meta.url));
  const defaultPath = join(
    baseDir,
    '..',
    'dotnet',
    'DocxConverter',
    'bin',
    'Release',
    'net8.0',
    'publish',
    'DocxConverter.dll',
  );
  const resolvedDefaultPath = resolveExistingPath(defaultPath);
  if (existsSync(resolvedDefaultPath)) return resolvedDefaultPath;

  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve('@agent-fs/plugin-docx/package.json');
    const packageDir = dirname(packageJson);
    const fallbackPath = join(
      packageDir,
      'dotnet',
      'DocxConverter',
      'bin',
      'Release',
      'net8.0',
      'publish',
      'DocxConverter.dll',
    );
    const resolvedFallbackPath = resolveExistingPath(fallbackPath);
    if (existsSync(resolvedFallbackPath)) return resolvedFallbackPath;
  } catch {
    // 忽略解析失败
  }

  const candidates = [process.cwd(), baseDir];
  for (const startDir of candidates) {
    let current = startDir;
    for (let i = 0; i < 8; i += 1) {
      const candidatePath = join(
        current,
        'packages',
        'plugins',
        'plugin-docx',
        'dotnet',
        'DocxConverter',
        'bin',
        'Release',
        'net8.0',
        'publish',
        'DocxConverter.dll',
      );
      const resolvedCandidatePath = resolveExistingPath(candidatePath);
      if (existsSync(resolvedCandidatePath)) return resolvedCandidatePath;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return resolvedDefaultPath;
}

function resolvePackagedResourcePath(...pathSegments: string[]): string | null {
  const resourcesPath = Reflect.get(process, 'resourcesPath');
  if (typeof resourcesPath !== 'string' || resourcesPath.length === 0) {
    return null;
  }

  const packagedPath = resolveExistingPath(
    join(resourcesPath, 'converters', ...pathSegments),
  );
  return existsSync(packagedPath) ? packagedPath : null;
}

export function resolveExistingPath(inputPath: string): string {
  for (const candidate of buildPathCandidates(inputPath)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return inputPath;
}

export function resolveConverterLaunchTarget(inputPath: string): ConverterLaunchTarget {
  for (const candidate of buildLaunchPathCandidates(inputPath)) {
    if (!existsSync(candidate)) {
      continue;
    }

    if (candidate.endsWith('.dll')) {
      return {
        command: 'dotnet',
        args: [candidate],
        path: candidate,
      };
    }

    return {
      command: candidate,
      args: [],
      path: candidate,
    };
  }

  return {
    command: 'dotnet',
    args: [resolveExistingPath(inputPath)],
    path: resolveExistingPath(inputPath),
  };
}

function buildPathCandidates(inputPath: string): string[] {
  const candidates = [inputPath];
  if (inputPath.includes('app.asar')) {
    candidates.unshift(inputPath.replace(/app\.asar([/\\])/u, 'app.asar.unpacked$1'));
  }

  const executableCandidates = candidates.flatMap((candidate) => {
    if (!candidate.endsWith('.dll')) {
      return [];
    }

    const basePath = candidate.slice(0, -'.dll'.length);
    return process.platform === 'win32'
      ? [`${basePath}.exe`, basePath]
      : [basePath];
  });

  return Array.from(new Set([...executableCandidates, ...candidates]));
}

function buildLaunchPathCandidates(inputPath: string): string[] {
  return buildPathCandidates(inputPath);
}
