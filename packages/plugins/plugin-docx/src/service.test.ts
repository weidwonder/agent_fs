import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { DocxService } from './service';

function createFakeProcess() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();

  const process = Object.assign(emitter, {
    stdout,
    stdin,
    stderr,
    kill: vi.fn(),
  });

  return { process, stdout, stdin };
}

describe('DocxService', () => {
  let converterPath: string;

  beforeEach(() => {
    converterPath = '/tmp/DocxConverter.dll';
    if (!existsSync(converterPath)) {
      writeFileSync(converterPath, '');
    }
  });

  afterEach(() => {
    if (existsSync(converterPath)) {
      rmSync(converterPath);
    }
  });

  it('resolves convert when success response arrives', async () => {
    const { process, stdout, stdin } = createFakeProcess();
    const spawnFn = vi.fn().mockReturnValue(process as any);
    const service = new DocxService({ spawnFn, converterPath });

    let written = '';
    stdin.on('data', (chunk) => {
      written += chunk.toString();
    });

    await service.start();
    const promise = service.convert('/tmp/demo.docx');

    await new Promise((r) => setImmediate(r));
    const request = JSON.parse(written.trim());

    stdout.write(
      JSON.stringify({
        id: request.id,
        success: true,
        data: { markdown: '# Title', mappings: [] },
      }) + '\n',
    );

    await expect(promise).resolves.toEqual({
      markdown: '# Title',
      mappings: [],
    });
  });

  it('rejects convert when error response arrives', async () => {
    const { process, stdout, stdin } = createFakeProcess();
    const spawnFn = vi.fn().mockReturnValue(process as any);
    const service = new DocxService({ spawnFn, converterPath });

    let written = '';
    stdin.on('data', (chunk) => {
      written += chunk.toString();
    });

    await service.start();
    const promise = service.convert('/tmp/demo.docx');

    await new Promise((r) => setImmediate(r));
    const request = JSON.parse(written.trim());

    stdout.write(
      JSON.stringify({
        id: request.id,
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'not found' },
      }) + '\n',
    );

    await expect(promise).rejects.toThrow('FILE_NOT_FOUND');
  });
});
