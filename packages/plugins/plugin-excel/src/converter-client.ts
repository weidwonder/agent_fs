import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface, type Interface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConvertResponse, JsonRpcRequest, JsonRpcResponse } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ConverterProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  kill: (signal?: NodeJS.Signals) => void;
  on: (event: 'exit' | 'close' | 'error', listener: (...args: any[]) => void) => void;
}

export interface ConverterClientOptions {
  dotnetPath?: string;
  spawnFn?: (command: string, args: string[]) => ConverterProcess;
}

interface ConverterLaunchTarget {
  command: string;
  args: string[];
  path: string;
}

export class ConverterClient {
  private process: ConverterProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private options: ConverterClientOptions;

  constructor(options: ConverterClientOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.process) return;

    const converterPath = resolveConverterPath(this.options.dotnetPath);
    const launchTarget = resolveConverterLaunchTarget(converterPath);
    if (!existsSync(launchTarget.path)) {
      throw new Error(`ExcelConverter 未找到: ${launchTarget.path}`);
    }

    this.process = (this.options.spawnFn ?? defaultSpawn)(
      launchTarget.command,
      launchTarget.args,
    );

    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line) => {
      this.handleResponse(line);
    });

    this.process.on('exit', () => {
      this.process = null;
      this.readline = null;
    });

    await this.ping();
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      await this.send('shutdown', {});
    } catch {
      // ignore
    }

    this.process.kill();
    this.process = null;
    this.readline = null;
  }

  async convert(filePath: string): Promise<ConvertResponse> {
    const result = await this.send<ConvertResponse>('convert', { filePath });
    return result;
  }

  async ping(): Promise<void> {
    await this.send('ping', {});
  }

  private async send<T>(method: string, params: unknown): Promise<T> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Converter process not running');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private handleResponse(line: string): void {
    try {
      const response: JsonRpcResponse = JSON.parse(line);
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch {
      // ignore
    }
  }
}

function defaultSpawn(command: string, args: string[]): ConverterProcess {
  return spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
  }) as ConverterProcess;
}

export function resolveConverterPath(customPath?: string): string {
  if (customPath) return resolveExistingPath(customPath);

  const packagedPath = resolvePackagedResourcePath('excel', 'ExcelConverter.dll');
  if (packagedPath) return packagedPath;

  const defaultPath = join(
    __dirname,
    'dotnet',
    'ExcelConverter.dll'
  );
  const resolvedDefaultPath = resolveExistingPath(defaultPath);
  if (existsSync(resolvedDefaultPath)) return resolvedDefaultPath;

  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve('@agent-fs/plugin-excel/package.json');
    const packageDir = dirname(packageJson);
    const fallbackPath = join(packageDir, 'dist', 'dotnet', 'ExcelConverter.dll');
    const resolvedFallbackPath = resolveExistingPath(fallbackPath);
    if (existsSync(resolvedFallbackPath)) return resolvedFallbackPath;
  } catch {
    // 忽略解析失败
  }

  const candidates = [process.cwd(), __dirname];
  for (const startDir of candidates) {
    let current = startDir;
    for (let i = 0; i < 8; i += 1) {
      const candidatePath = join(
        current,
        'packages',
        'plugins',
        'plugin-excel',
        'dist',
        'dotnet',
        'ExcelConverter.dll'
      );
      const resolvedCandidatePath = resolveExistingPath(candidatePath);
      if (existsSync(resolvedCandidatePath)) return resolvedCandidatePath;

      const projectCandidatePath = join(
        current,
        'packages',
        'plugins',
        'plugin-excel',
        'dotnet',
        'excel-converter',
        'ExcelConverter.csproj'
      );
      const resolvedProjectCandidatePath = resolveExistingPath(projectCandidatePath);
      if (existsSync(resolvedProjectCandidatePath)) return resolvedProjectCandidatePath;

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

    if (candidate.endsWith('.csproj')) {
      return {
        command: 'dotnet',
        args: ['run', '--project', candidate],
        path: candidate,
      };
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

  const resolvedPath = resolveExistingPath(inputPath);
  if (resolvedPath.endsWith('.csproj')) {
    return {
      command: 'dotnet',
      args: ['run', '--project', resolvedPath],
      path: resolvedPath,
    };
  }

  return {
    command: 'dotnet',
    args: [resolvedPath],
    path: resolvedPath,
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
