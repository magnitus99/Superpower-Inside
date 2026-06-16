import { describe, expect, it } from 'vitest';
import { createToolCallPanelView } from './tool-call-panel';
import type { ToolCallRecord } from './types';

describe('ToolCallPanel view model contract', () => {
  it('실행 중 placeholder를 계산한다', () => {
    expect(createToolCallPanelView([], true)).toEqual({
      labelText: '🔧 툴 호출',
      placeholder: {
        className: 'superpower-inside-tool-call placeholder',
        iconText: '🔧',
        nameText: '툴 실행 중...',
        statusClassName: 'superpower-inside-tool-call-status running',
      },
      rows: [],
    });
  });

  it('tool call 행의 승인/인자/결과 모델을 계산한다', () => {
    const calls: ToolCallRecord[] = [
      {
        id: 'call-1',
        name: 'search_notes',
        arguments: ' { "q": "obsidian" } ',
        result: '검색 결과',
        status: 'running',
        approved: false,
      },
      {
        id: 'call-2',
        name: 'open_note',
        arguments: '',
        status: 'success',
      },
    ];

    expect(createToolCallPanelView(calls, false).rows).toEqual([
      {
        rowId: 'tool-call-call-1',
        className: 'superpower-inside-tool-call',
        iconText: '🔧',
        nameText: 'search_notes',
        status: 'running',
        statusClassName: 'superpower-inside-tool-call-status running',
        showRunningDots: true,
        statusText: '',
        approvalRequired: true,
        safetyDecision: 'approval-required',
        availableActions: ['approve-tool', 'copy-args'],
        argumentsPreview: '{ "q": "obsidian" }',
        result: '검색 결과',
        resultSummary: '검색 결과',
        resultApplied: false,
      },
      {
        rowId: 'tool-call-call-2',
        className: 'superpower-inside-tool-call',
        iconText: '🔧',
        nameText: 'open_note',
        status: 'success',
        statusClassName: 'superpower-inside-tool-call-status success',
        showRunningDots: false,
        statusText: '✓',
        approvalRequired: false,
        safetyDecision: 'completed',
        availableActions: ['copy-result', 'regenerate-answer'],
        argumentsPreview: '',
        result: undefined,
        resultSummary: undefined,
        resultApplied: false,
      },
    ]);
  });
});
