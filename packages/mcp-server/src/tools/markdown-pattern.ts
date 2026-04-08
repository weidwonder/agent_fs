function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function normalizePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return '**/*';
  }
  return trimmed.replaceAll('\\', '/');
}

export function matchMarkdownPath(path: string, pattern?: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/');
  const source = normalizePattern(pattern ?? '**/*');

  let regex = '^';
  for (let i = 0; i < source.length; i += 1) {
    const current = source[i];
    const next = source[i + 1];

    if (current === '*' && next === '*') {
      const nextNext = source[i + 2];
      if (nextNext === '/') {
        regex += '(?:.*/)?';
        i += 2;
      } else {
        regex += '.*';
        i += 1;
      }
      continue;
    }

    if (current === '*') {
      regex += '[^/]*';
      continue;
    }

    if (current === '?') {
      regex += '[^/]';
      continue;
    }

    regex += escapeRegex(current);
  }

  regex += '$';
  return new RegExp(regex, 'u').test(normalizedPath);
}
