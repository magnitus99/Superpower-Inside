import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  createContextAttachmentViews,
  createContextBudgetSnapshot,
  createDataBoundarySnapshot,
  createResearchDataBoundarySnapshot,
  withDataBoundaryProviderUsage,
} from './context-composer';
import type { ContextAttachment, SourceCitation } from './types';

describe('context composer contract', () => {
  beforeEach(() => {
    setLanguage('en');
  });

  const attachments: ContextAttachment[] = [
    {
      id: 'file:Notes/A.md',
      type: 'file',
      name: 'Notes/A.md',
      label: 'Notes/A.md',
      status: 'attached',
      reason: 'Explicit file mention',
      estimatedChars: 1200,
      actualChars: 1180,
      pinned: true,
      sourceIds: ['file-1'],
    },
    {
      id: 'rag:auto',
      type: 'rag',
      name: 'auto',
      label: 'Related notes',
      status: 'partial',
      detail: 'Some candidates left out',
      reason: 'Nearby notes for this question',
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
      detail: 'Not connected',
      excluded: true,
    },
  ];

  const citations: SourceCitation[] = [
    { id: 'file-1', filePath: 'Notes/A.md', status: 'verified', preview: 'Evidence' },
    { id: 'rag-1', filePath: 'Notes/B.md', status: 'low-relevance', preview: 'Candidate' },
  ];

  it('creates composer attachment view state with status, reason, and size', () => {
    expect(createContextAttachmentViews(attachments)).toEqual([
      expect.objectContaining({
        id: 'file:Notes/A.md',
        statusText: 'Included',
        reasonText: 'Explicit file mention',
        sizeText: '1,180 chars',
        pinned: true,
      }),
      expect.objectContaining({
        id: 'rag:auto',
        statusText: 'Partially included',
        detail: 'Some candidates left out',
      }),
      expect.objectContaining({
        id: 'mcp:search',
        statusText: 'Excluded',
      }),
    ]);
  });

  it('stores included, excluded, and truncated state in a per-turn budget snapshot', () => {
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

  it('creates a per-turn data boundary snapshot in user-facing language', () => {
    expect(
      createDataBoundarySnapshot({
        providerLabel: 'Ollama',
        model: 'llama3.1',
        hasUserQuestion: true,
        recentConversationMessageCount: 4,
        hasSystemPrompt: true,
        attachments,
        citations,
        mcpServerNames: ['search'],
      }),
    ).toEqual({
      providerLabel: 'Ollama',
      model: 'llama3.1',
      localOnly: ['Draft and source-card state', 'Source-card state'],
      sentToProvider: [
        'Current question',
        '4 recent conversation messages',
        'Answer instructions',
        '2 notes and references',
        '2 source previews',
      ],
      sentToMcp: ['search'],
      privacyNotes: ['1 item was left out and was not sent.'],
      providerPayload: {
        userQuestion: true,
        recentConversationMessages: 4,
        systemPrompt: true,
        attachedContexts: 2,
        citationPreviews: 2,
        toolResults: 0,
        researchDocuments: 0,
      },
    });
  });

  it('updates provider usage when local tool results and research documents are sent later', () => {
    const initial = createDataBoundarySnapshot({
      providerLabel: 'Ollama',
      model: 'llama3.1',
      hasUserQuestion: true,
      recentConversationMessageCount: 1,
      hasSystemPrompt: false,
      attachments: [],
      citations: [],
      mcpServerNames: [],
    });

    expect(
      withDataBoundaryProviderUsage(initial, {
        toolResultCount: 3,
        researchDocumentCount: 12,
        mcpServerNames: ['search', 'search', 'remote'],
      }),
    ).toMatchObject({
      sentToProvider: [
        'Current question',
        '1 recent conversation message',
        '3 tool results',
        'Evidence from 12 locally selected documents',
      ],
      sentToMcp: ['search', 'remote'],
    });
  });

  it('언어가 바뀐 뒤에도 semantic system prompt 상태를 유지한다', () => {
    setLanguage('ko');
    const initial = createDataBoundarySnapshot({
      providerLabel: 'Ollama',
      model: 'llama3.1',
      hasUserQuestion: true,
      recentConversationMessageCount: 0,
      hasSystemPrompt: true,
      attachments: [],
      citations: [],
      mcpServerNames: [],
    });

    setLanguage('en');
    const updated = withDataBoundaryProviderUsage(initial, { toolResultCount: 1 });

    expect(updated.providerPayload?.systemPrompt).toBe(true);
    expect(updated.sentToProvider).toEqual([
      'Current question',
      'Answer instructions',
      '1 tool result',
    ]);
  });

  it('볼트 전체 조사는 실제 provider envelope만 데이터 경계에 표시한다', () => {
    const initial = createResearchDataBoundarySnapshot({
      providerLabel: 'OpenRouter',
      model: 'model',
      previousUserQuestionCount: 3,
    });
    const completed = withDataBoundaryProviderUsage(initial, { researchDocumentCount: 12 });

    expect(completed.providerPayload).toEqual({
      userQuestion: true,
      recentConversationMessages: 1,
      systemPrompt: true,
      attachedContexts: 0,
      citationPreviews: 0,
      toolResults: 0,
      researchDocuments: 12,
    });
    expect(completed.sentToMcp).toEqual([]);
    expect(completed.sentToProvider).toEqual([
      'Current question',
      '1 recent conversation message',
      'Answer instructions',
      'Evidence from 12 locally selected documents',
    ]);
  });
});
