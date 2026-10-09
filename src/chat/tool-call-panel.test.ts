import { describe, expect, it } from 'vitest';
import { createToolCallPanelView } from './tool-call-panel';
import type { ToolCallRecord } from './types';

describe('ToolCallPanel view model contract', () => {
  it('실행 중 placeholder를 계산한다', () => {
    expect(createToolCallPanelView([], true)).toEqual({
      labelText: '툴 호출',
      iconName: 'wrench',
      placeholder: {
        className: 'superpower-inside-tool-call-group placeholder',
        iconName: 'loader-circle',
        nameText: '툴 실행 중...',
        statusClassName: 'superpower-inside-tool-call-status running',
        statusIconName: 'loader-circle',
        statusText: '실행 중',
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
        className: 'superpower-inside-tool-call-group',
        iconName: 'wrench',
        nameText: 'search_notes',
        status: 'running',
        statusClassName: 'superpower-inside-tool-call-status running',
        statusIconName: 'loader-circle',
        statusText: '실행 중',
        approvalRequired: true,
        safetyDecision: 'approval-required',
        availableActions: ['approve-tool', 'copy-args'],
        argumentsPreview: '{ "q": "obsidian" }',
        result: '검색 결과',
        resultSummary: '검색 결과',
        resultApplied: false,
        detailsLabel: '인자 · 툴 결과',
      },
      {
        rowId: 'tool-call-call-2',
        className: 'superpower-inside-tool-call-group',
        iconName: 'wrench',
        nameText: 'open_note',
        status: 'success',
        statusClassName: 'superpower-inside-tool-call-status success',
        statusIconName: 'check',
        statusText: '완료',
        approvalRequired: false,
        safetyDecision: 'completed',
        availableActions: ['copy-result', 'regenerate-answer'],
        argumentsPreview: '',
        result: undefined,
        resultSummary: undefined,
        resultApplied: false,
        detailsLabel: '툴 결과',
      },
    ]);
  });

  it('오류 상태를 아이콘 이름과 눈에 보이는 텍스트로 계산한다', () => {
    const [row] = createToolCallPanelView(
      [
        {
          id: 'call-error',
          name: 'broken_tool',
          arguments: '{}',
          status: 'error',
          result: '실패 원인',
        },
      ],
      false,
    ).rows;

    expect(row).toEqual(
      expect.objectContaining({
        statusIconName: 'circle-alert',
        statusText: '오류',
      }),
    );
    expect(JSON.stringify(row)).not.toContain('✗');
  });

  it('네이티브 Vault 호출은 내부 함수명 대신 작업과 결과를 표시한다', () => {
    const [row] = createToolCallPanelView(
      [
        {
          id: 'native-search',
          name: 'superpower_inside',
          serverName: 'Superpower Inside',
          executionKind: 'native',
          arguments: '{"action":"search","query":"Alpha"}',
          status: 'success',
          resultSummary: '볼트 검색 결과 4개',
        },
      ],
      false,
    ).rows;

    expect(row?.nameText).toBe('Superpower Inside · 검색');
    expect(row?.resultSummary).toBe('볼트 검색 결과 4개');
    expect(row?.detailsLabel).toBe('인자');
  });

  it('분리된 네이티브 도구도 action 인자가 없어도 작업명을 표시한다', () => {
    const [row] = createToolCallPanelView(
      [
        {
          id: 'native-read',
          name: 'superpower_inside_read',
          serverName: 'Superpower Inside',
          executionKind: 'native',
          arguments: '{"path":"Decision.md"}',
          status: 'success',
        },
      ],
      false,
    ).rows;

    expect(row?.nameText).toBe('Superpower Inside · 문서 읽기');
  });

  it('관련 문서 탐색은 일반 검색과 구분된 작업명을 표시한다', () => {
    const [row] = createToolCallPanelView(
      [
        {
          id: 'native-related',
          name: 'superpower_inside_related',
          serverName: 'Superpower Inside',
          executionKind: 'native',
          arguments: '{"path":"Decision.md"}',
          status: 'success',
        },
      ],
      false,
    ).rows;

    expect(row?.nameText).toBe('Superpower Inside · 관련 문서 찾기');
  });

  it('MCP alias 대신 승인 대상 서버와 실제 도구 이름을 표시한다', () => {
    const [row] = createToolCallPanelView(
      [
        {
          id: 'mcp-delete',
          name: 'mcp_filesystem_delete_file_deadbeef',
          serverName: 'filesystem',
          actualToolName: 'delete_file',
          mcpBindingSource: 'catalog',
          executionKind: 'mcp',
          arguments: '{"path":"Draft.md"}',
          status: 'running',
          approved: false,
        },
      ],
      false,
    ).rows;

    expect(row?.nameText).toBe('filesystem · delete_file');
    expect(row?.nameText).not.toContain('deadbeef');
  });
});
