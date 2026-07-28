import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../llm/providers';
import { appendAgenticCheckpoint, planAgenticToolTurn } from './tool-orchestration';
import type { ContextAttachment, ToolCallRecord } from './types';

const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'superpower_inside_search',
      description: 'Search vault evidence candidates.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'superpower_inside_read',
      description: 'Read one verified vault source.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

describe('적극적 도구 오케스트레이션 경계', () => {
  it('명시적인 볼트 근거 질문은 첫 응답부터 도구 사용을 요구한다', () => {
    const plan = planAgenticToolTurn({
      question: '내 볼트에서 이 결정의 근거를 찾아줘',
      contextAttachments: [],
      explicitToolServerCount: 0,
      toolDefinitions: definitions,
      toolCalls: [],
      phase: 'initial',
      round: 0,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      requiresEvidence: true,
      toolChoice: 'required',
      shouldRetryWithoutTools: true,
      nextAction: 'use-tool',
    });
  });

  it('검색 후보만 있으면 원문 read를 다음 행동으로 고정한다', () => {
    const toolCalls: ToolCallRecord[] = [
      {
        id: 'search-1',
        name: 'superpower_inside_search',
        arguments: '{"query":"결정"}',
        status: 'success',
        normalizedResult: '{"action":"search","hits":[{"path":"Decision.md"}],"totalHits":1}',
      },
    ];
    const plan = planAgenticToolTurn({
      question: '내 노트에서 원인과 반론을 모두 조사해줘',
      contextAttachments: [],
      explicitToolServerCount: 0,
      toolDefinitions: definitions,
      toolCalls,
      phase: 'after-tools',
      round: 1,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      toolChoice: 'required',
      nextAction: 'verify-source',
      ledger: { candidateSearches: 1, verifiedReads: 0 },
    });
    expect(plan?.checkpoint).toContain('원인과 반론을 모두 조사해줘');
  });

  it('비교 요청은 검색 후보 중 서로 다른 두 번째 원문을 직접 읽도록 요구한다', () => {
    const toolCalls: ToolCallRecord[] = [
      {
        id: 'search-compare',
        name: 'superpower_inside_search',
        arguments: '{"query":"A B"}',
        status: 'success',
        normalizedResult:
          '{"action":"search","hits":[{"path":"A.md"},{"path":"B.md"}],"totalHits":2}',
      },
      {
        id: 'read-a',
        name: 'superpower_inside_read',
        arguments: '{"path":"A.md"}',
        status: 'success',
        normalizedResult: '{"path":"A.md","truncated":false,"content":"A evidence"}',
      },
    ];

    const plan = planAgenticToolTurn({
      question: '내 볼트에서 A와 B의 연결점을 비교해줘',
      contextAttachments: [],
      explicitToolServerCount: 0,
      toolDefinitions: definitions,
      toolCalls,
      phase: 'after-tools',
      round: 2,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      toolChoice: 'required',
      nextAction: 'verify-source',
      ledger: { verifiedReads: 1, verifiedSources: 1 },
    });
    expect(plan?.checkpoint).toContain('another distinct relevant source');
  });

  it('비교 근거가 충분해지면 도구 선택을 닫고 즉시 최종 합성으로 전환한다', () => {
    const toolCalls: ToolCallRecord[] = [
      {
        id: 'search-compare-complete',
        name: 'superpower_inside_search',
        arguments: '{"query":"A B"}',
        status: 'success',
        normalizedResult:
          '{"action":"search","hits":[{"path":"A.md"},{"path":"B.md"}],"totalHits":2}',
      },
      ...['A.md', 'B.md'].map(
        (path, index): ToolCallRecord => ({
          id: `read-complete-${index}`,
          name: 'superpower_inside_read',
          arguments: JSON.stringify({ path }),
          status: 'success',
          normalizedResult: JSON.stringify({
            path,
            truncated: false,
            content: `${path} evidence`,
          }),
        }),
      ),
    ];

    const plan = planAgenticToolTurn({
      question: '내 볼트에서 A와 B를 비교해줘',
      contextAttachments: [],
      explicitToolServerCount: 0,
      toolDefinitions: definitions,
      toolCalls,
      phase: 'after-tools',
      round: 3,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      toolChoice: 'none',
      shouldRetryWithoutTools: false,
      nextAction: 'answer',
      ledger: { verifiedSources: 2 },
    });
  });

  it('사용자가 직접 붙인 파일 근거가 있으면 불필요한 첫 검색을 강제하지 않는다', () => {
    const attachment: ContextAttachment = {
      id: 'file:Decision.md',
      type: 'file',
      name: 'Decision.md',
      label: 'Decision.md',
      status: 'attached',
      sourceIds: ['vault:Decision.md:1-10'],
    };
    const plan = planAgenticToolTurn({
      question: '이 문서를 요약해줘',
      contextAttachments: [attachment],
      explicitToolServerCount: 0,
      toolDefinitions: definitions,
      toolCalls: [],
      phase: 'initial',
      round: 0,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      requiresEvidence: false,
      toolChoice: 'auto',
      nextAction: 'answer',
    });
  });

  it('자동 RAG 후보는 명시적인 볼트 조사 요청의 도구 사용을 대체하지 않는다', () => {
    const attachment: ContextAttachment = {
      id: 'rag:Decision.md',
      type: 'rag',
      name: 'Decision.md',
      label: 'Decision.md',
      status: 'attached',
      sourceIds: ['vault:Decision.md:1-10'],
    };
    const plan = planAgenticToolTurn({
      question: '내 볼트에서 이 결정과 반론을 조사해줘',
      contextAttachments: [attachment],
      explicitToolServerCount: 0,
      toolDefinitions: definitions,
      toolCalls: [],
      phase: 'initial',
      round: 0,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      requiresEvidence: true,
      toolChoice: 'required',
      nextAction: 'use-tool',
    });
  });

  it('자동으로 부분 첨부된 폴더도 명시적인 볼트 조사를 완료한 근거로 취급하지 않는다', () => {
    const attachment: ContextAttachment = {
      id: 'folder:auto:neville',
      type: 'folder',
      name: 'neville',
      label: 'neville',
      status: 'partial',
      sourceIds: ['vault:neville/A Lesson in Scripture.txt:1-30'],
    };
    const plan = planAgenticToolTurn({
      question: '이 볼트에서 Neville과 성경 관련 노트를 각각 조사해줘',
      contextAttachments: [attachment],
      explicitToolServerCount: 0,
      toolDefinitions: definitions,
      toolCalls: [],
      phase: 'initial',
      round: 0,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      requiresEvidence: true,
      toolChoice: 'required',
      nextAction: 'use-tool',
    });
  });

  it('checkpoint를 추가해도 이전의 완전한 tool transcript를 보존한다', () => {
    const messages = [
      { role: 'assistant' as const, content: '', toolCalls: [] },
      {
        role: 'tool' as const,
        content: '{"ok":true}',
        tool_call_id: 'read-1',
        name: 'superpower_inside_read',
      },
    ];

    const result = appendAgenticCheckpoint(messages, '최신 목표를 답하세요.');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(messages[0]);
    expect(result[1]).toEqual(messages[1]);
    expect(result[2]).toEqual({
      role: 'user',
      content: '최신 목표를 답하세요.',
    });
  });
});
