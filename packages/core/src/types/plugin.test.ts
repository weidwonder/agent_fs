import { describe, it, expectTypeOf } from 'vitest';
import type { DocumentPlugin, PositionMapping, SearchableEntry, DocumentConversionResult } from './plugin';

describe('Plugin Types', () => {
  it('DocumentPlugin interface should have required properties', () => {
    expectTypeOf<DocumentPlugin>().toHaveProperty('name');
    expectTypeOf<DocumentPlugin>().toHaveProperty('supportedExtensions');
    expectTypeOf<DocumentPlugin>().toHaveProperty('toMarkdown');
  });

  it('PositionMapping should have correct structure', () => {
    const mapping: PositionMapping = {
      markdownRange: { startLine: 1, endLine: 10 },
      originalLocator: 'page:1',
    };
    expectTypeOf(mapping.markdownRange.startLine).toBeNumber();
    expectTypeOf(mapping.originalLocator).toBeString();
  });

  it('DocumentConversionResult should support searchableText', () => {
    const searchable: SearchableEntry = {
      text: '销售额 100000',
      markdownLine: 2,
      locator: 'Sheet1!A1:C100',
    };

    const result: DocumentConversionResult = {
      markdown: '# 表格',
      mapping: [],
      searchableText: [searchable],
    };

    expectTypeOf(result.searchableText).toEqualTypeOf<SearchableEntry[] | undefined>();
  });
});
