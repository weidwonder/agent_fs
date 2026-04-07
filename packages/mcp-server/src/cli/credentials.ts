import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface TargetCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string;
}

type CredentialsStore = Record<string, TargetCredential>;

function credentialsPath(): string {
  return join(homedir(), '.agent_fs', 'credentials.json');
}

export function normalizeTarget(target: string): string {
  return target.replace(/\/+$/, '');
}

export function readCredentials(): CredentialsStore {
  const path = credentialsPath();
  if (!existsSync(path)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CredentialsStore;
  } catch {
    return {};
  }
}

export function saveCredential(target: string, credential: TargetCredential): void {
  const dir = join(homedir(), '.agent_fs');
  mkdirSync(dir, { recursive: true });

  const store = readCredentials();
  store[normalizeTarget(target)] = credential;

  const path = credentialsPath();
  writeFileSync(path, JSON.stringify(store, null, 2));
  chmodSync(path, 0o600);
}

export function getCredential(target: string): TargetCredential | null {
  const store = readCredentials();
  const credential = store[normalizeTarget(target)];
  if (!credential) {
    return null;
  }

  if (new Date(credential.expiresAt) <= new Date()) {
    return null;
  }

  return credential;
}
