import { describe, expect, it } from 'vitest';
import {
  createContextAttachmentViews,
  createContextBudgetSnapshot,
  createDataBoundarySnapshot,
} from './context-composer';
import type { ContextAttachment, SourceCitation } from './types';

describe('context composer contract', () => {
  const attachments: ContextAttachment[] = [
    {
      id: 'file:Notes/A.md',
      type: 'file',
      name: 'Notes/A.md',
      label: 'Notes/A.md',
      status: 'attached',
      reason: '명시 파일 멘션',
      estimatedChars: 1200,
      actualChars: 1180,
      pinned: true,
      sourceIds: ['file-1'],
    },
    {
      id: 'rag:auto',
      type: 'rag',
      name: 'auto',
      label: '자동 RAG',
      status: 'partial',
      detail: '일부 후보 제외',
      reason: '질문과 관련된 최근 인덱스',
      estimatedChars: 4000,
      actualChars: 2200,
      sourceIds: ['rag-1'],
    },
    {
      id: 'mcp:search',
      type: 'mcp-server',
      name: 'search',
      label: 'search',
      status: 'missing',
      detail: '연결 끊김',
      excluded: true,
    },
  ];
  const citations: SourceCitation[] = [
    { id: 'file-1', filePath: 'Notes/A.md', status: 'verified', preview: '근거' },
    { id: 'rag-1', filePath: 'Notes/B.md', status: 'low-relevance', preview: '후보' },
  ];

  it('attachment 상태/이유/크기를 전송 전 composer view로 만든다', () => {
    expect(createContextAttachmentViews(attachments)).toEqual([
      expect.objectContaining({
        id: 'file:Notes/A.md',
        statusText: '포함됨',
        reasonText: '명시 파일 멘션',
        sizeText: '1,180자',
        pinned: true,
      }),
      expect.objectContaining({
        id: 'rag:auto',
        statusText: '일부 포함',
        detail: '일부 후보 제외',
      }),
      expect.objectContaining({
        id: 'mcp:search',
        statusText: '제외됨',
      }),
    ]);
  });

  it('per-turn budget snapshot은 포함/제외/truncated 상태를 저장한다', () => {
    expect(
      createContextBudgetSnapshot({
        maxChars: 6000,
        usedChars: 6000,
        attachments,
        citations,
      }),
    ).toEqual({
      maxChars: 6000,
      usedChars: 6000,
      remainingChars: 0,
      attachmentCount: 3,
      citationCount: 2,
      truncated: true,
      includedAttachmentIds: ['file:Notes/A.md', 'rag:auto'],
      excludedAttachmentIds: ['mcp:search'],
    });
  });

  it('provider/MCP로 나가는 데이터 경계를 per-turn snapshot으로 만든다', () => {
    expect(
      createDataBoundarySnapshot({
        providerLabel: 'Ollama',
        model: 'llama3.1',
        hasSystemPrompt: true,
        attachments,
        citations,
        mcpServerNames: ['search'],
      }),
    ).toEqual({
      providerLabel: 'Ollama',
      model: 'llama3.1',
      localOnly: ['초안 저장소', '출처 카드 UI 상태'],
      sentToProvider: ['시스템 프롬프트', '첨부 컨텍스트 2개', '출처 preview 2개'],
      sentToMcp: ['search'],
      privacyNotes: ['제외된 attachment 1개는 provider 요청에 포함하지 않습니다.'],
    });
  });
});
