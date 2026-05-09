import type { PositionMapping } from '@agent-fs/core';

export function extractPageFromLocator(locator: string): number | null {
  const match = locator.match(/^page:(\d+)(?:$|[:/])/u);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

export function insertPageMarkers(
  markdown: string,
  mappings: PositionMapping[],
): { markdown: string; mappings: PositionMapping[] } {
  if (!markdown.trim() || mappings.length === 0) {
    return { markdown, mappings };
  }

  const lines = markdown.split('\n');
  const adjustedMappings = mappings.map((mapping) => ({
    markdownRange: { ...mapping.markdownRange },
    originalLocator: mapping.originalLocator,
  }));
  const sortedMappings = [...adjustedMappings].sort(
    (left, right) =>
      left.markdownRange.startLine - right.markdownRange.startLine,
  );

  let currentPage: number | null = null;
  let offset = 0;

  for (const mapping of sortedMappings) {
    mapping.markdownRange.startLine += offset;
    mapping.markdownRange.endLine += offset;

    const page = extractPageFromLocator(mapping.originalLocator);
    if (!page || page === currentPage) {
      continue;
    }

    const markerLines =
      mapping.markdownRange.startLine === 1
        ? [`<!-- page: ${page} -->`, '']
        : ['', `<!-- page: ${page} -->`, ''];

    lines.splice(mapping.markdownRange.startLine - 1, 0, ...markerLines);
    mapping.markdownRange.startLine += markerLines.length;
    mapping.markdownRange.endLine += markerLines.length;
    offset += markerLines.length;
    currentPage = page;
  }

  return {
    markdown: lines.join('\n'),
    mappings: adjustedMappings,
  };
}
