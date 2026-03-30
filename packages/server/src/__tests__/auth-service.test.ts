// packages/server/src/__tests__/auth-service.test.ts

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/jwt.js';

// ─── Password hashing ────────────────────────────────────────────────────────

describe('password utilities', () => {
  it('hashes a password and verifies it correctly', async () => {
    const raw = 'MySecurePass123!';
    const hash = await hashPassword(raw);
    expect(hash).not.toBe(raw);
    expect(hash.startsWith('$2b$')).toBe(true);
    await expect(verifyPassword(raw, hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-password');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('produces different hashes for the same password (salt)', async () => {
    const raw = 'SamePassword!';
    const hash1 = await hashPassword(raw);
    const hash2 = await hashPassword(raw);
    expect(hash1).not.toBe(hash2);
    await expect(verifyPassword(raw, hash1)).resolves.toBe(true);
    await expect(verifyPassword(raw, hash2)).resolves.toBe(true);
  });
});

// ─── JWT sign / verify ───────────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-key-for-unit-tests';

describe('JWT utilities', () => {
  it('signs and verifies an access token roundtrip', () => {
    const payload = { userId: 'user-1', tenantId: 'tenant-1', role: 'owner' };
    const token = signAccessToken(payload, TEST_SECRET, '15m');
    expect(typeof token).toBe('string');

    const decoded = verifyToken(token, TEST_SECRET);
    expect(decoded['userId']).toBe(payload.userId);
    expect(decoded['tenantId']).toBe(payload.tenantId);
    expect(decoded['role']).toBe(payload.role);
    expect(decoded['type']).toBe('access');
  });

  it('signs and verifies a refresh token roundtrip', () => {
    const userId = 'user-2';
    const token = signRefreshToken(userId, TEST_SECRET, '7d');
    expect(typeof token).toBe('string');

    const decoded = verifyToken(token, TEST_SECRET);
    expect(decoded['userId']).toBe(userId);
    expect(decoded['type']).toBe('refresh');
  });

  it('throws when verifying with wrong secret', () => {
    const token = signAccessToken(
      { userId: 'u', tenantId: 't', role: 'member' },
      TEST_SECRET,
      '15m',
    );
    expect(() => verifyToken(token, 'wrong-secret')).toThrow();
  });

  it('throws on expired token', async () => {
    const token = signAccessToken(
      { userId: 'u', tenantId: 't', role: 'member' },
      TEST_SECRET,
      '1ms',
    );
    // Wait 2ms so token is expired
    await new Promise((r) => setTimeout(r, 2));
    expect(() => verifyToken(token, TEST_SECRET)).toThrow();
  });
});
