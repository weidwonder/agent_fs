import { describe, it, expectTypeOf } from 'vitest';
import type { DocumentPlugin, PositionMapping } from './plugin';

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
});
