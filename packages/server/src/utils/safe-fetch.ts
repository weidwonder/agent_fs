// packages/server/src/utils/safe-fetch.ts

import { lookup } from 'node:dns/promises';

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^0\./,
  /^localhost$/i,
];

function isPrivateAddress(host: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(host));
}

async function isPrivateHost(hostname: string): Promise<boolean> {
  // Block hostnames that look like private addresses without DNS lookup
  if (isPrivateAddress(hostname)) return true;
  try {
    const { address } = await lookup(hostname);
    return isPrivateAddress(address);
  } catch {
    // DNS failure — block request
    return true;
  }
}

export async function safeFetch(
  url: string,
  options?: { maxSizeBytes?: number; timeoutMs?: number },
): Promise<Response> {
  const { maxSizeBytes = 100 * 1024 * 1024, timeoutMs = 30_000 } = options ?? {};

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Disallowed URL scheme: ${parsed.protocol}`);
  }

  if (await isPrivateHost(parsed.hostname)) {
    throw new Error(`Blocked request to private/internal host: ${parsed.hostname}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let redirectCount = 0;
  const MAX_REDIRECTS = 3;

  async function doFetch(fetchUrl: string): Promise<Response> {
    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect with no Location header');
      if (redirectCount >= MAX_REDIRECTS) throw new Error('Too many redirects');
      redirectCount++;

      const redirectUrl = new URL(location, fetchUrl);
      if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
        throw new Error(`Disallowed redirect scheme: ${redirectUrl.protocol}`);
      }
      if (await isPrivateHost(redirectUrl.hostname)) {
        throw new Error(`Blocked redirect to private/internal host: ${redirectUrl.hostname}`);
      }
      return doFetch(redirectUrl.toString());
    }

    // Enforce size limit via content-length header
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      throw new Error(`Response too large: ${contentLength} bytes exceeds ${maxSizeBytes}`);
    }

    // Enforce size limit by reading in chunks
    const reader = response.body?.getReader();
    if (!reader) return response;

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxSizeBytes) {
          reader.cancel().catch(() => undefined);
          throw new Error(`Response too large: exceeds ${maxSizeBytes} bytes`);
        }
        chunks.push(value);
      }
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  try {
    return await doFetch(url);
  } finally {
    clearTimeout(timer);
  }
}
