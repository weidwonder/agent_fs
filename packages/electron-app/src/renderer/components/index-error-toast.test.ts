import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { IndexErrorToast } from './IndexErrorToast';

describe('IndexErrorToast', () => {
  it('应展示错误信息与关闭按钮', () => {
    const html = renderToStaticMarkup(
      React.createElement(IndexErrorToast, {
        error: '测试错误',
        onClose: () => undefined,
      })
    );

    expect(html).toContain('索引失败：测试错误');
    expect(html).toContain('关闭索引错误提示');
  });
});
