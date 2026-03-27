import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ProjectCard } from './ProjectCard';
import { TooltipProvider } from './ui/tooltip';

describe('ProjectCard', () => {
  it('知识库运行中仍应允许打开知识库设置', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ProjectCard, {
          project: {
            path: '/tmp/demo',
            alias: 'Demo',
            projectId: 'p-1',
            summary: 'summary',
            lastUpdated: '2026-03-27T00:00:00.000Z',
            totalFileCount: 3,
            totalChunkCount: 12,
            valid: true,
          },
          isUpdating: true,
          progress: {
            phase: 'summary',
            currentFile: '/tmp/demo/a.md',
            processed: 1,
            total: 3,
          },
          onUpdate: () => undefined,
          onManage: () => undefined,
          onRemove: () => undefined,
          onSummaryChange: () => undefined,
        })
      )
    );

    expect(html).toContain('disabled="" aria-label="增量更新知识库"');
    expect(html).toContain('aria-label="打开知识库设置"');
    expect(html).not.toContain('disabled="" aria-label="打开知识库设置"');
    expect(html).toContain('disabled="" aria-label="移除知识库"');
  });
});
