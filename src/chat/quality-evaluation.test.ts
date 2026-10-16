import { describe, expect, it } from 'vitest';
import { createNativeVaultToolDefinitions } from '../agent/native-vault-tool';
import type { ToolCallRecord } from './types';
import { evaluateToolTrace } from './quality-evaluation';

describe('채팅 품질 trace 평가', () => {
  it('두 문서를 수집했어도 답변이 한쪽만 연결하면 근거 충족으로 세지 않는다', () => {
    const toolCalls: ToolCallRecord[] = ['Copper.md', 'Glass.md'].map((path, index) => ({
      id: `read-${index}`,
      name: 'superpower_inside_read',
      status: 'success',
      arguments: JSON.stringify({ path }),
      normalizedResult: JSON.stringify({
        action: 'read',
        path,
        startLine: 1,
        endLine: 1,
        totalLines: 1,
        content: '합성 근거',
        truncated: false,
        citations: [],
      }),
    }));
    expect(
      evaluateToolTrace({
        question: '내 볼트에서 두 방식의 차이',
        answer: '한쪽 근거만 사용한 비교 [vault:Copper.md:1-1]',
        toolCalls,
        toolDefinitions: createNativeVaultToolDefinitions(),
        citations: [
          {
            id: 'vault:Copper.md:1-1',
            filePath: 'Copper.md',
            status: 'verified',
            preview: '합성 근거',
          },
        ],
      }),
    ).toMatchObject({ verifiedSources: 2, answerGrounded: false });
  });
  it('범위 표현이 없어도 근거 없는 일반 지식을 grounded 성공으로 세지 않는다', () => {
    expect(
      evaluateToolTrace({
        question: '두 합성 저장 방식의 차이',
        answer: '일반 지식으로 작성한 비교',
        toolCalls: [],
        citations: [],
      }).answerGrounded,
    ).toBe(false);
  });

  it('한 문서의 여러 출처 카드를 서로 다른 원문으로 세지 않는다', () => {
    const result = evaluateToolTrace({
      question: '합성 자료 설명',
      answer: '합성 근거',
      toolCalls: [],
      citations: [1, 2, 3].map((line) => ({
        id: `s-${line}`,
        filePath: 'Synthetic.md',
        preview: '합성 근거',
        line,
        status: 'verified',
      })),
    });
    expect(result.verifiedSources).toBe(1);
    expect(result.verifiedAnswerCitationCount).toBe(3);
    expect(result.semanticQualityAssessed).toBe(false);
  });

  it('자동 검색 비교의 한쪽 문서만 인용한 답변을 근거 충족으로 세지 않는다', () => {
    expect(
      evaluateToolTrace({
        question: '구리 저장소와 유리 큐의 차이',
        answer: '한쪽 문서만으로 한 비교',
        toolCalls: [],
        toolDefinitions: createNativeVaultToolDefinitions(),
        contextAttachments: [
          { id: 'rag:auto', type: 'rag', name: 'auto', label: 'RAG', status: 'attached' },
        ],
        citations: [1, 2].map((line) => ({
          id: `s-${line}`,
          filePath: 'Copper.md',
          preview: '합성 근거',
          line,
          status: 'verified',
        })),
      }),
    ).toMatchObject({ requiresEvidence: true, verifiedSources: 1, answerGrounded: false });
  });
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
      semanticQualityAssessed: false,
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
