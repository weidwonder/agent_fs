import type { PositionMapping } from '@agent-fs/core';
import type {
  MinerUContentItem,
  MinerUContentList,
  MinerUResult,
} from './mineru';

export function buildMinerUPositionMapping(
  result: MinerUResult,
): PositionMapping[] {
  const markdownLines = result.markdown.split('\n');
  const totalLines = markdownLines.length;
  const contentList = result.contentList ?? [];
  const totalPages = getTotalPages(contentList, result.totalPages);

  if (!totalPages) {
    return buildFallbackPageMapping(result.markdown);
  }

  const mapping: PositionMapping[] = [];
  const pages = groupContentByPage(contentList, totalPages);
  let currentLine = 1;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx += 1) {
    const pageNumber = pageIdx + 1;
    const pageItems = pages[pageIdx] ?? [];

    if (currentLine > totalLines) {
      break;
    }

    const pageTexts = extractPageTexts(pageItems);
    const pageRange = findPageRangeInMarkdown(markdownLines, pageTexts, currentLine);

    if (pageRange) {
      mapping.push({
        markdownRange: pageRange,
        originalLocator: `page:${pageNumber}`,
      });
      currentLine = pageRange.endLine + 1;
      continue;
    }

    const remainingLines = totalLines - currentLine + 1;
    const remainingPages = totalPages - pageIdx;
    const linesPerPage = Math.max(1, Math.ceil(remainingLines / remainingPages));
    const startLine = currentLine;
    const endLine = Math.min(currentLine + linesPerPage - 1, totalLines);

    mapping.push({
      markdownRange: { startLine, endLine },
      originalLocator: `page:${pageNumber}`,
    });
    currentLine = endLine + 1;
  }

  return mapping;
}

export function extractMinerUPageTextMap(
  result: MinerUResult,
): Map<number, string> {
  const pageTextMap = new Map<number, string>();
  const contentList = result.contentList ?? [];
  const totalPages = getTotalPages(contentList, result.totalPages);

  if (totalPages) {
    const groupedPages = groupContentByPage(contentList, totalPages);
    for (let pageIdx = 0; pageIdx < groupedPages.length; pageIdx += 1) {
      const pageTexts = extractPageTexts(groupedPages[pageIdx]);
      if (pageTexts.length > 0) {
        pageTextMap.set(pageIdx + 1, pageTexts.join('\n\n'));
      }
    }
  }

  if (pageTextMap.size > 0) {
    return pageTextMap;
  }

  const markdownLines = result.markdown.split('\n');
  for (const mapping of buildMinerUPositionMapping(result)) {
    const pageNumber = extractPageNumber(mapping.originalLocator);
    if (!pageNumber) {
      continue;
    }

    const pageMarkdown = markdownLines
      .slice(
        mapping.markdownRange.startLine - 1,
        mapping.markdownRange.endLine,
      )
      .join('\n')
      .trim();

    if (pageMarkdown) {
      pageTextMap.set(pageNumber, pageMarkdown);
    }
  }

  return pageTextMap;
}

function extractPageTexts(pageItems: MinerUContentItem[]): string[] {
  const texts: string[] = [];

  for (const item of pageItems) {
    collectText(texts, item.text);
    collectText(texts, item.list_items);
    collectText(texts, item.table_body);
    collectText(texts, item.code_body);
    collectText(texts, item.image_caption);
    collectText(texts, item.table_caption);
    collectText(texts, item.image_footnote);
    collectText(texts, item.table_footnote);
  }

  return texts.filter((text) => text.length > 0);
}

function collectText(texts: string[], value: unknown): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      texts.push(trimmed);
    }
    return;
  }

  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const trimmed = item.trim();
    if (trimmed) {
      texts.push(trimmed);
    }
  }
}

function getTotalPages(
  contentList: MinerUContentList,
  totalPages?: number,
): number | null {
  if (typeof totalPages === 'number' && totalPages > 0) {
    return totalPages;
  }

  let maxPageIdx = -1;
  for (const item of contentList) {
    if (typeof item.page_idx === 'number' && item.page_idx > maxPageIdx) {
      maxPageIdx = item.page_idx;
    }
  }

  return maxPageIdx >= 0 ? maxPageIdx + 1 : null;
}

function groupContentByPage(
  contentList: MinerUContentList,
  totalPages: number,
): MinerUContentItem[][] {
  const pages: MinerUContentItem[][] = Array.from(
    { length: totalPages },
    () => [],
  );

  for (const item of contentList) {
    if (typeof item.page_idx !== 'number') {
      continue;
    }
    if (item.page_idx < 0 || item.page_idx >= totalPages) {
      continue;
    }
    pages[item.page_idx].push(item);
  }

  return pages;
}

function findPageRangeInMarkdown(
  markdownLines: string[],
  pageTexts: string[],
  startLine: number,
): { startLine: number; endLine: number } | null {
  if (pageTexts.length === 0) {
    return null;
  }

  const firstText = pageTexts[0];
  let foundStart = -1;

  for (let index = startLine - 1; index < markdownLines.length; index += 1) {
    if (markdownLines[index].includes(firstText)) {
      foundStart = index + 1;
      break;
    }
  }

  if (foundStart === -1) {
    return null;
  }

  const lastText = pageTexts[pageTexts.length - 1];
  let foundEnd = foundStart;

  for (let index = foundStart - 1; index < markdownLines.length; index += 1) {
    if (markdownLines[index].includes(lastText)) {
      foundEnd = index + 1;
      break;
    }
  }

  return { startLine: foundStart, endLine: foundEnd };
}

function buildFallbackPageMapping(markdown: string): PositionMapping[] {
  const lines = markdown.split('\n');
  const totalLines = lines.length;
  const estimatedPages = Math.ceil(totalLines / 20);
  const linesPerPage = Math.ceil(totalLines / estimatedPages);
  const mapping: PositionMapping[] = [];

  for (let page = 1; page <= estimatedPages; page += 1) {
    const startLine = (page - 1) * linesPerPage + 1;
    const endLine = Math.min(page * linesPerPage, totalLines);

    mapping.push({
      markdownRange: { startLine, endLine },
      originalLocator: `page:${page}`,
    });
  }

  return mapping;
}

function extractPageNumber(locator: string): number | null {
  const match = locator.match(/^page:(\d+)$/u);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}
