const BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && refreshToken) {
    const refreshResp = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (refreshResp.ok) {
      const data = (await refreshResp.json()) as { accessToken: string };
      setTokens(data.accessToken, refreshToken!);
      headers['Authorization'] = `Bearer ${data.accessToken}`;
      response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    } else {
      clearTokens();
      window.location.href = '/login';
      throw new Error('Session expired');
    }
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw new Error(err.error ?? `API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function uploadFiles(projectId: string, files: File[]): Promise<unknown> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('file', file);
  }

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${BASE_URL}/projects/${projectId}/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  return response.json();
}

export function createEventSource(path: string): EventSource {
  const url = `${BASE_URL}${path}${accessToken ? `?token=${encodeURIComponent(accessToken)}` : ''}`;
  return new EventSource(url);
}
