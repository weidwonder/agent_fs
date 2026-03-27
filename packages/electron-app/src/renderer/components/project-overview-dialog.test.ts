import { describe, expect, it } from 'vitest';
import {
  PROJECT_OVERVIEW_DIALOG_BODY_CLASSNAME,
  PROJECT_OVERVIEW_DIALOG_CONTENT_CLASSNAME,
  resolveProjectRunningMode,
} from './ProjectOverviewDialog';

describe('ProjectOverviewDialog', () => {
  it('运行中重新打开时应从当前索引状态恢复运行模式', () => {
    expect(resolveProjectRunningMode('/tmp/demo', '/tmp/demo', 'backfill-summary')).toBe(
      'backfill-summary'
    );
    expect(resolveProjectRunningMode('/tmp/demo', '/tmp/other', 'backfill-summary')).toBeNull();
    expect(resolveProjectRunningMode('/tmp/demo', '/tmp/demo', null)).toBeNull();
  });

  it('应限制弹窗高度并让主体区域滚动', () => {
    expect(PROJECT_OVERVIEW_DIALOG_CONTENT_CLASSNAME).toContain('sm:max-h-[85vh]');
    expect(PROJECT_OVERVIEW_DIALOG_CONTENT_CLASSNAME).toContain('overflow-hidden');
    expect(PROJECT_OVERVIEW_DIALOG_BODY_CLASSNAME).toContain('overflow-y-auto');
  });
});
