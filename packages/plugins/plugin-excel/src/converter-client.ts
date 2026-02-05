import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConvertResponse, JsonRpcRequest, JsonRpcResponse } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ConverterClientOptions {
  dotnetPath?: string;
}

export class ConverterClient {
  private process: ChildProcess | null = null;
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
    if (!existsSync(converterPath)) {
      throw new Error(`ExcelConverter 未找到: ${converterPath}`);
    }

    this.process = spawn('dotnet', ['run', '--project', converterPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

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

function resolveConverterPath(customPath?: string): string {
  if (customPath) return customPath;

  const defaultPath = join(
    __dirname,
    '..',
    'dotnet',
    'excel-converter',
    'ExcelConverter.csproj'
  );
  if (existsSync(defaultPath)) return defaultPath;

  const candidates = [process.cwd(), __dirname];
  for (const startDir of candidates) {
    let current = startDir;
    for (let i = 0; i < 8; i += 1) {
      const candidatePath = join(
        current,
        'packages',
        'plugins',
        'plugin-excel',
        'dotnet',
        'excel-converter',
        'ExcelConverter.csproj'
      );
      if (existsSync(candidatePath)) return candidatePath;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return defaultPath;
}
