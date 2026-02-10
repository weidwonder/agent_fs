interface MarkdownRange {
  startLine: number;
  endLine: number;
}

interface LocatorMapping {
  markdownRange: MarkdownRange;
  originalLocator: string;
}

interface ResolveDisplayLocatorInput {
  filePath: string;
  locator: string;
  chunkLineStart?: number;
  chunkLineEnd?: number;
  mappings?: LocatorMapping[];
}

const EXCEL_EXTENSIONS = new Set(['.xls', '.xlsx']);

function parseLocatorLineRange(locator: string): { start: number; end: number } | null {
  const rangeMatch = /^(?:line|lines):(\d+)-(\d+)$/u.exec(locator.trim());
  if (rangeMatch) {
    return {
      start: Number.parseInt(rangeMatch[1], 10),
      end: Number.parseInt(rangeMatch[2], 10),
    };
  }

  const singleMatch = /^(?:line|lines):(\d+)$/u.exec(locator.trim());
  if (singleMatch) {
    const line = Number.parseInt(singleMatch[1], 10);
    return { start: line, end: line };
  }

  return null;
}

function getFileExtension(path: string): string {
  const lowerPath = path.toLowerCase();
  const dotIndex = lowerPath.lastIndexOf('.');
  if (dotIndex < 0) {
    return '';
  }
  return lowerPath.slice(dotIndex);
}

function selectBestMapping(
  mappings: LocatorMapping[],
  lineStart: number,
  lineEnd: number
): LocatorMapping | null {
  let best: { mapping: LocatorMapping; overlap: number } | null = null;

  for (const mapping of mappings) {
    const startLine = mapping.markdownRange?.startLine;
    const endLine = mapping.markdownRange?.endLine;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
      continue;
    }

    const overlap = Math.max(
      0,
      Math.min(lineEnd, endLine) - Math.max(lineStart, startLine) + 1
    );
    if (overlap <= 0) {
      continue;
    }

    if (!best || overlap > best.overlap) {
      best = { mapping, overlap };
    }
  }

  return best?.mapping ?? null;
}

export function resolveDisplayLocator(input: ResolveDisplayLocatorInput): string {
  if (!input.locator) {
    return '';
  }

  if (/^sheet:[^/]+\/range:.+/u.test(input.locator)) {
    return input.locator;
  }

  if (!EXCEL_EXTENSIONS.has(getFileExtension(input.filePath))) {
    return input.locator;
  }

  const range =
    input.chunkLineStart && input.chunkLineEnd
      ? { start: input.chunkLineStart, end: input.chunkLineEnd }
      : parseLocatorLineRange(input.locator);
  if (!range) {
    return input.locator;
  }

  const mapping = selectBestMapping(input.mappings || [], range.start, range.end);
  if (!mapping) {
    return input.locator;
  }

  if (!/^sheet:[^/]+\/range:.+/u.test(mapping.originalLocator)) {
    return input.locator;
  }

  return mapping.originalLocator;
}
