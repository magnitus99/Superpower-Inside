import { describe, expect, it } from 'vitest';
import { createNativeVaultToolDefinitions } from '../agent/native-vault-tool';
import type { ToolCallRecord } from './types';
import { evaluateToolTrace } from './quality-evaluation';

describe('채팅 품질 trace 평가', () => {
  it('검색 후보와 원문 읽기를 답변 근거 승격 지표로 계산한다', () => {
    const toolCalls: ToolCallRecord[] = [
      {
        id: 'search-1',
        name: 'superpower_inside_search',
        arguments: '{"query":"결정"}',
        status: 'success',
        normalizedResult: JSON.stringify({
          action: 'search',
          query: '결정',
          queries: ['결정'],
          path: '',
          match: 'all',
          hits: [
            {
              path: 'Decision.md',
              startLine: 1,
              endLine: 3,
              preview: '결정의 근거',
              requiresRead: true,
              citationStatus: 'candidate',
            },
          ],
          scannedFiles: 1,
          unreadableFiles: 0,
          totalHits: 1,
          truncated: false,
          citations: [],
        }),
      },
      {
        id: 'read-1',
        name: 'superpower_inside_read',
        arguments: '{"path":"Decision.md"}',
        status: 'success',
        normalizedResult: JSON.stringify({
          action: 'read',
          path: 'Decision.md',
          startLine: 1,
          endLine: 3,
          truncated: false,
          content: '결정의 근거',
          totalLines: 3,
          citations: [
            {
              id: 'vault:Decision.md:1-3',
              filePath: 'Decision.md',
              status: 'verified',
              preview: '결정의 근거',
            },
          ],
        }),
      },
    ];

    expect(
      evaluateToolTrace({
        question: '내 볼트에서 결정의 근거를 찾아줘',
        answer: '결정의 근거는 다음과 같습니다. [vault:Decision.md:1-3]',
        toolCalls,
        citations: [
          {
            id: 'vault:Decision.md:1-3',
            filePath: 'Decision.md',
            status: 'verified',
            preview: '결정의 근거',
            selectionReason: 'hybrid',
          },
        ],
        toolDefinitions: createNativeVaultToolDefinitions(),
      }),
    ).toMatchObject({
      totalCalls: 2,
      successfulCalls: 2,
      toolSuccessRate: 1,
      candidateSearches: 1,
      verifiedReads: 1,
      verifiedSources: 1,
      embeddingBackedAnswerCitations: 1,
      hybridAnswerCitations: 1,
      answerGrounded: true,
      nextAction: 'answer',
    });
  });

  it('근거가 필요한 빈 답변과 실패 호출을 grounded 성공으로 세지 않는다', () => {
    expect(
      evaluateToolTrace({
        question: '내 볼트에서 이 결정의 근거를 찾아줘',
        answer: '',
        toolCalls: [
          {
            id: 'failed-search',
            name: 'superpower_inside_search',
            arguments: '{"query":"결정"}',
            status: 'error',
            result: '검색 실패',
          },
        ],
        toolDefinitions: createNativeVaultToolDefinitions(),
        citations: [
          {
            id: 'vault:Decision.md:1-3',
            filePath: 'Decision.md',
            status: 'verified',
            preview: '결정의 근거',
            selectionReason: 'vector',
          },
        ],
      }),
    ).toMatchObject({
      completedCalls: 1,
      successfulCalls: 0,
      failedCalls: 1,
      toolSuccessRate: 0,
      verifiedSources: 1,
      embeddingBackedAnswerCitations: 1,
      answerGrounded: false,
    });
  });
});
