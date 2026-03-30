// packages/server/src/utils/safe-fetch.ts

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

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(hostname));
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

  if (isPrivateHost(parsed.hostname)) {
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

      // Validate redirect target
      const redirectUrl = new URL(location, fetchUrl);
      if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
        throw new Error(`Disallowed redirect scheme: ${redirectUrl.protocol}`);
      }
      if (isPrivateHost(redirectUrl.hostname)) {
        throw new Error(`Blocked redirect to private/internal host: ${redirectUrl.hostname}`);
      }
      return doFetch(redirectUrl.toString());
    }

    // Enforce size limit via content-length check
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      throw new Error(`Response too large: ${contentLength} bytes exceeds ${maxSizeBytes}`);
    }

    return response;
  }

  try {
    return await doFetch(url);
  } finally {
    clearTimeout(timer);
  }
}
