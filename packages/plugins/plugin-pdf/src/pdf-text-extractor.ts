import { readFile } from 'node:fs/promises';
import type { PositionMapping } from '@agent-fs/core';
import type {
  TextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api';

const DEFAULT_MIN_TEXT_CHARS_PER_PAGE = 100;
const PAGE_SEPARATOR_LINE_COUNT = 3;
const LINE_BREAK_DELTA = 4;
const BOILERPLATE_REPEAT_RATIO = 0.6;
const MAX_BOILERPLATE_LINES = 2;
const MIN_BOILERPLATE_LINE_LENGTH = 8;
const WHITESPACE_PATTERN = /\s+/gu;
const NULL_BYTE_PATTERN = /\u0000/gu;
const URL_PATTERN = /https?:\/\/\S+/gu;
const DIGIT_PATTERN = /\d+/gu;

export interface PageText {
  pageNumber: number;
  text: string;
  charCount: number;
}

export interface PageClassification {
  pageNumber: number;
  type: 'text' | 'scan';
  charCount: number;
  extractedText: string;
}

export interface DocumentClassification {
  type: 'text' | 'scan' | 'mixed';
  pages: PageClassification[];
  totalPages: number;
  textPageCount: number;
  scanPageCount: number;
}

export interface TextExtractionOptions {
  enabled?: boolean;
  minTextCharsPerPage?: number;
}

export async function extractTextPerPage(filePath: string): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(filePath));
  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  let documentProxy: Awaited<typeof loadingTask.promise> | null = null;

  try {
    documentProxy = await loadingTask.promise;
    const pages: PageText[] = [];

    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const page = await documentProxy.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = buildPageText(textContent.items);

      pages.push({
        pageNumber,
        text,
        charCount: text.trim().length,
      });
    }

    return pages;
  } finally {
    if (documentProxy) {
      await documentProxy.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

export function classifyDocument(
  pages: PageText[],
  minChars = DEFAULT_MIN_TEXT_CHARS_PER_PAGE,
): DocumentClassification {
  const normalizedMinChars = normalizeMinTextCharsPerPage(minChars);
  const boilerplate = detectRepeatedBoilerplate(pages);
  const classifiedPages = pages.map((page) => {
    const strippedText = stripRepeatedBoilerplate(page.text, boilerplate);
    const effectiveCharCount =
      strippedText === page.text.trim() ? page.charCount : strippedText.length;

    return {
      pageNumber: page.pageNumber,
      type: effectiveCharCount < normalizedMinChars ? 'scan' : 'text',
      charCount: effectiveCharCount,
      extractedText: page.text,
    } satisfies PageClassification;
  });
  const textPageCount = classifiedPages.filter((page) => page.type === 'text').length;
  const scanPageCount = classifiedPages.length - textPageCount;

  if (textPageCount === classifiedPages.length) {
    return {
      type: 'text',
      pages: classifiedPages,
      totalPages: classifiedPages.length,
      textPageCount,
      scanPageCount,
    };
  }

  if (scanPageCount === classifiedPages.length) {
    return {
      type: 'scan',
      pages: classifiedPages,
      totalPages: classifiedPages.length,
      textPageCount,
      scanPageCount,
    };
  }

  return {
    type: 'mixed',
    pages: classifiedPages,
    totalPages: classifiedPages.length,
    textPageCount,
    scanPageCount,
  };
}

export function directTextToMarkdown(
  pages: PageClassification[],
): { markdown: string; mapping: PositionMapping[] } {
  const markdownParts: string[] = [];
  const mapping: PositionMapping[] = [];
  let currentLine = 1;

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageText = page.extractedText.trim();
    const pageLines = pageText ? pageText.split('\n') : [''];

    markdownParts.push(pageText);
    mapping.push({
      markdownRange: {
        startLine: currentLine,
        endLine: currentLine + pageLines.length - 1,
      },
      originalLocator: `page:${page.pageNumber}`,
    });

    currentLine += pageLines.length;
    if (index < pages.length - 1) {
      markdownParts.push('', '---', '');
      currentLine += PAGE_SEPARATOR_LINE_COUNT;
    }
  }

  return {
    markdown: markdownParts.join('\n'),
    mapping,
  };
}

export function getDefaultMinTextCharsPerPage(): number {
  return DEFAULT_MIN_TEXT_CHARS_PER_PAGE;
}

function buildPageText(items: Array<TextItem | TextMarkedContent>): string {
  const lines: string[] = [];
  let currentLine: string[] = [];
  let lastY: number | null = null;

  for (const item of items) {
    if (!isTextItem(item)) {
      continue;
    }

    const text = normalizeText(item.str);
    const currentY = Number.isFinite(item.transform[5]) ? item.transform[5] : null;
    const shouldBreakLine =
      currentLine.length > 0 &&
      currentY !== null &&
      lastY !== null &&
      Math.abs(currentY - lastY) > LINE_BREAK_DELTA;

    if (shouldBreakLine) {
      flushLine(lines, currentLine);
    }

    if (text) {
      currentLine.push(text);
    }

    lastY = currentY ?? lastY;
    if (item.hasEOL) {
      flushLine(lines, currentLine);
    }
  }

  flushLine(lines, currentLine);
  return lines.join('\n').trim();
}

function normalizeText(value: string): string {
  return value
    .replace(NULL_BYTE_PATTERN, '')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
}

function detectRepeatedBoilerplate(pages: PageText[]): {
  leading: Set<string>;
  trailing: Set<string>;
} {
  const threshold = Math.max(2, Math.ceil(pages.length * BOILERPLATE_REPEAT_RATIO));
  const leadingCounts = new Map<string, number>();
  const trailingCounts = new Map<string, number>();

  for (const page of pages) {
    const lines = splitPageLines(page.text);
    for (let index = 0; index < Math.min(lines.length, MAX_BOILERPLATE_LINES); index += 1) {
      countBoilerplateLine(leadingCounts, lines[index]);
      countBoilerplateLine(trailingCounts, lines[lines.length - 1 - index]);
    }
  }

  return {
    leading: collectBoilerplateLines(leadingCounts, threshold),
    trailing: collectBoilerplateLines(trailingCounts, threshold),
  };
}

function stripRepeatedBoilerplate(
  text: string,
  boilerplate: { leading: Set<string>; trailing: Set<string> },
): string {
  const lines = splitPageLines(text);

  while (lines[0] && boilerplate.leading.has(normalizeBoilerplateLine(lines[0]))) {
    lines.shift();
  }
  while (
    lines.length > 0 &&
    boilerplate.trailing.has(normalizeBoilerplateLine(lines[lines.length - 1]))
  ) {
    lines.pop();
  }

  return lines.join('\n').trim();
}

function flushLine(lines: string[], currentLine: string[]): void {
  if (currentLine.length === 0) {
    return;
  }

  const line = currentLine.join(' ').replace(WHITESPACE_PATTERN, ' ').trim();
  currentLine.length = 0;

  if (line) {
    lines.push(line);
  }
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

function normalizeMinTextCharsPerPage(value: number): number {
  if (Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return DEFAULT_MIN_TEXT_CHARS_PER_PAGE;
}

function splitPageLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function countBoilerplateLine(counts: Map<string, number>, line?: string): void {
  if (!line) {
    return;
  }
  const normalized = normalizeBoilerplateLine(line);
  if (normalized.length < MIN_BOILERPLATE_LINE_LENGTH) {
    return;
  }
  counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
}

function collectBoilerplateLines(
  counts: Map<string, number>,
  threshold: number,
): Set<string> {
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([line]) => line),
  );
}

function normalizeBoilerplateLine(line: string): string {
  return line
    .toLowerCase()
    .replace(URL_PATTERN, '<url>')
    .replace(DIGIT_PATTERN, '#')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
}
