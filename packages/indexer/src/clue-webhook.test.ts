import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { notifyClueWebhook } from './clue-webhook';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('notifyClueWebhook', () => {
  it('应发送 documents_changed payload 并附带签名头', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    vi.stubGlobal('fetch', fetchSpy);

    await notifyClueWebhook({
      webhookUrl: 'http://127.0.0.1:3000/clue-webhook',
      webhookSecret: 'secret-1',
      projectId: 'project-1',
      projectPath: '/tmp/project-1',
      changes: [
        {
          fileId: 'file-1',
          filePath: 'docs/a.md',
          action: 'modified',
          summary: '摘要',
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = String(requestInit.body);
    const payload = JSON.parse(body) as {
      event: string;
      project_id: string;
      project_path: string;
      changes: Array<{ file_id: string; file_path: string; action: string; summary: string }>;
    };
    const headers = requestInit.headers as Record<string, string>;

    expect(url).toBe('http://127.0.0.1:3000/clue-webhook');
    expect(payload.event).toBe('documents_changed');
    expect(payload.project_id).toBe('project-1');
    expect(payload.project_path).toBe('/tmp/project-1');
    expect(payload.changes[0]).toEqual({
      file_id: 'file-1',
      file_path: 'docs/a.md',
      action: 'modified',
      summary: '摘要',
    });
    expect(headers['X-Webhook-Signature']).toBe(
      `sha256=${createHmac('sha256', 'secret-1').update(body).digest('hex')}`
    );
  });

  it('Webhook 失败时不应抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      notifyClueWebhook({
        webhookUrl: 'http://127.0.0.1:3000/clue-webhook',
        projectId: 'project-1',
        projectPath: '/tmp/project-1',
        changes: [
          {
            fileId: 'file-1',
            filePath: 'docs/a.md',
            action: 'added',
            summary: '',
          },
        ],
      })
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/network failed/u));
  });
});
