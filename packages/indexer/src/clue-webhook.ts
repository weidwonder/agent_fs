import { createHmac } from 'node:crypto';

export interface DocumentChange {
  fileId: string;
  filePath: string;
  action: 'added' | 'modified';
  summary: string;
}

export interface NotifyClueWebhookParams {
  webhookUrl?: string;
  webhookSecret?: string;
  projectId: string;
  projectPath: string;
  changes: DocumentChange[];
}

interface DocumentsChangedPayload {
  event: 'documents_changed';
  project_id: string;
  project_path: string;
  timestamp: string;
  changes: Array<{
    file_id: string;
    file_path: string;
    action: 'added' | 'modified';
    summary: string;
  }>;
}

export async function notifyClueWebhook(params: NotifyClueWebhookParams): Promise<void> {
  if (!params.webhookUrl || params.changes.length === 0) {
    return;
  }

  const payload: DocumentsChangedPayload = {
    event: 'documents_changed',
    project_id: params.projectId,
    project_path: params.projectPath,
    timestamp: new Date().toISOString(),
    changes: params.changes.map((change) => ({
      file_id: change.fileId,
      file_path: change.filePath,
      action: change.action,
      summary: change.summary,
    })),
  };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (params.webhookSecret) {
    headers['X-Webhook-Signature'] = `sha256=${createHmac('sha256', params.webhookSecret)
      .update(body)
      .digest('hex')}`;
  }

  try {
    const response = await fetch(params.webhookUrl, {
      method: 'POST',
      headers,
      body,
    });
    if (!response.ok) {
      console.warn(`Clue webhook 请求失败: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Clue webhook 请求失败: ${detail}`);
  }
}
