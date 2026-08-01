import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../llm/providers';
import {
  appendAgenticCheckpoint,
  planAgenticToolTurn,
  selectAgenticToolDefinitions,
} from './tool-orchestration';
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

const listDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'superpower_inside_list',
    description: 'List one bounded vault inventory page.',
    parameters: { type: 'object', properties: {} },
  },
};

function normalizedSearchResult(paths: readonly string[]): string {
  return JSON.stringify({
    action: 'search',
    query: 'query',
    queries: ['query'],
    path: '',
    match: 'all',
    hits: paths.map((path) => ({
      path,
      startLine: 1,
      preview: 'candidate',
      citationStatus: 'candidate',
      requiresRead: true,
    })),
    scannedFiles: paths.length,
    unreadableFiles: 0,
    totalHits: paths.length,
    truncated: false,
    citations: [],
  });
}

function normalizedReadResult(path: string): string {
  return JSON.stringify({
    action: 'read',
    path,
    startLine: 1,
    endLine: 1,
    totalLines: 1,
    truncated: false,
    content: `${path} evidence`,
    citations: [],
  });
}

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
        normalizedResult: normalizedSearchResult(['Decision.md']),
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
        normalizedResult: normalizedSearchResult(['A.md', 'B.md']),
      },
      {
        id: 'read-a',
        name: 'superpower_inside_read',
        arguments: '{"path":"A.md"}',
        status: 'success',
        normalizedResult: normalizedReadResult('A.md'),
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
        normalizedResult: normalizedSearchResult(['A.md', 'B.md']),
      },
      ...['A.md', 'B.md'].map(
        (path, index): ToolCallRecord => ({
          id: `read-complete-${index}`,
          name: 'superpower_inside_read',
          arguments: JSON.stringify({ path }),
          status: 'success',
          normalizedResult: normalizedReadResult(path),
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

  it('문서 목록과 근거를 함께 물으면 inventory와 content를 모두 요구한다', () => {
    const plan = planAgenticToolTurn({
      question: '내 볼트의 문서 목록과 배포 결정 근거를 함께 알려줘',
      contextAttachments: [],
      explicitToolServerCount: 0,
      toolDefinitions: [listDefinition, ...definitions],
      toolCalls: [],
      phase: 'initial',
      round: 0,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      nativeEvidenceRequirement: 'inventory',
      nativeEvidenceRequirements: ['inventory', 'content'],
      requiredToolNames: [
        'superpower_inside_list',
        'superpower_inside_search',
        'superpower_inside_read',
      ],
    });
  });

  it('할 일 목록 검색은 파일 inventory가 아니라 content 근거를 요구한다', () => {
    const plan = planAgenticToolTurn({
      question: '내 노트에서 할 일 목록을 찾아줘',
      contextAttachments: [],
      explicitToolServerCount: 0,
      toolDefinitions: [listDefinition, ...definitions],
      toolCalls: [],
      phase: 'initial',
      round: 0,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      nativeEvidenceRequirement: 'content',
      nativeEvidenceRequirements: ['content'],
      requiredToolNames: ['superpower_inside_search', 'superpower_inside_read'],
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

  it('Rust 후속 정책이 read를 요구하면 provider catalog도 read 하나로 좁힌다', () => {
    const result = selectAgenticToolDefinitions(definitions, ['superpower_inside_read']);

    expect(result.map((definition) => definition.function.name)).toEqual([
      'superpower_inside_read',
    ]);
  });

  it('정책의 도구 이름이 현재 catalog에 없으면 복구를 위해 전체 catalog를 보존한다', () => {
    const result = selectAgenticToolDefinitions(definitions, ['missing_tool']);

    expect(result).toEqual(definitions);
  });

  it('요구된 도구 중 하나라도 없으면 부분 catalog로 잘못 좁히지 않는다', () => {
    const result = selectAgenticToolDefinitions(definitions, [
      'superpower_inside_search',
      'missing_tool',
    ]);

    expect(result).toEqual(definitions);
  });

  it('여러 명시 MCP 중 아직 확인하지 않은 서버의 도구만 정확히 남긴다', () => {
    const externalDefinitions: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'jira_search',
          description: 'MCP server "jira". Search Jira issues.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'github_search',
          description: 'MCP server "github". Search GitHub pull requests.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const result = selectAgenticToolDefinitions(
      [...definitions, ...externalDefinitions],
      ['jira_search', 'github_search'],
      ['github'],
    );

    expect(result.map((definition) => definition.function.name)).toEqual([
      'github_search',
    ]);
  });

  it('명시 MCP 서버 매핑이 catalog와 어긋나면 전체 catalog를 보존한다', () => {
    const externalDefinition: ToolDefinition = {
      type: 'function',
      function: {
        name: 'github_search',
        description: 'MCP server "github". Search GitHub pull requests.',
        parameters: { type: 'object', properties: {} },
      },
    };
    const catalog = [...definitions, externalDefinition];

    const result = selectAgenticToolDefinitions(
      catalog,
      ['github_search'],
      ['jira'],
    );

    expect(result).toEqual(catalog);
  });

  it('명시 MCP와 native 요구가 함께 남으면 두 범주의 최소 catalog를 보존한다', () => {
    const githubDefinition: ToolDefinition = {
      type: 'function',
      function: {
        name: 'github_search',
        description: 'MCP server "github". Search GitHub pull requests.',
        parameters: { type: 'object', properties: {} },
      },
    };

    const result = selectAgenticToolDefinitions(
      [...definitions, githubDefinition],
      ['superpower_inside_read', 'github_search'],
      ['github'],
    );

    expect(result.map((definition) => definition.function.name)).toEqual([
      'superpower_inside_read',
      'github_search',
    ]);
  });

  it('최종 예산 라운드에도 미확인 명시 MCP 범위를 checkpoint에 보존한다', () => {
    const githubDefinition: ToolDefinition = {
      type: 'function',
      function: {
        name: 'github_search',
        description: 'MCP server "github". Search GitHub pull requests.',
        parameters: { type: 'object', properties: {} },
      },
    };

    const plan = planAgenticToolTurn({
      question: 'GitHub에서 오늘 상태를 조사해줘',
      contextAttachments: [],
      explicitToolServerCount: 1,
      explicitToolServerNames: ['github'],
      toolDefinitions: [githubDefinition],
      toolCalls: [],
      phase: 'after-tools',
      round: 2,
      maxRounds: 2,
    });

    expect(plan).toMatchObject({
      toolChoice: 'none',
      nextAction: 'answer',
      requiredExternalServerNames: ['github'],
    });
    expect(plan?.checkpoint).toContain('did not return verified results');
    expect(plan?.checkpoint).toContain('missing server coverage');
  });
});
