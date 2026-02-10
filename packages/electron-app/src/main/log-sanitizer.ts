const EXACT_SENSITIVE_KEYS = new Set([
  'api_key',
  'api_secret',
  'access_key',
  'secret_key',
  'private_key',
  'client_secret',
  'password',
  'authorization',
  'token',
  'auth_token',
  'access_token',
  'refresh_token',
  'id_token',
]);

const normalizeKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[\s-]+/gu, '_')
    .toLowerCase();

const isSensitiveKey = (key: string): boolean => {
  const normalizedKey = normalizeKey(key);
  if (EXACT_SENSITIVE_KEYS.has(normalizedKey)) {
    return true;
  }
  return (
    normalizedKey.endsWith('_token') ||
    normalizedKey.endsWith('_secret') ||
    normalizedKey.endsWith('_password')
  );
};

const sanitizeValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeValue(nestedValue, seen);
      }
    }

    seen.delete(value);
    return output;
  }

  return value;
};

export const sanitizeForLog = <T>(value: T): T => sanitizeValue(value, new WeakSet()) as T;
