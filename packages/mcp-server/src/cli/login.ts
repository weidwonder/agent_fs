import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { normalizeTarget, saveCredential } from './credentials.js';

export async function loginCommand(target: string): Promise<void> {
  const normalizedTarget = normalizeTarget(target);
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const email = await rl.question('Email: ');
    const password = await rl.question('Password: ');

    console.log('正在登录...');

    const response = await fetch(`${normalizedTarget}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, client: 'cli' }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: response.statusText }));
      console.error(`登录失败: ${(errorBody as { error: string }).error}`);
      process.exit(1);
    }

    const result = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    saveCredential(normalizedTarget, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt,
      email,
    });

    console.log('✓ 登录成功，token 已保存');
  } finally {
    rl.close();
  }
}
