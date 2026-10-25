import type { DataAdapter, Vault } from 'obsidian';
import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessageWithMeta } from './types';
import { executeMcpToolCalls, type MCPRegistryLike } from './mcp-tool-execution';
import { listChatMetasAsync, listChats, loadChat, saveChat, saveAnswerNote } from './persistence';
import { appendAssistantToolRound } from './tool-execution';
import { planModelContextRust } from '../rag/rust-core';
import {
  CHAT_DEBUG_TRACE_HEADING,
  extractChatDebugTrace,
  type ChatTraceConfigSnapshot,
} from '../debug/chat-trace';

vi.mock('obsidian', () => {
  class MockTFile {
    path = '';
    name = '';
    basename = '';
    extension = '';
    stat = { ctime: 0, mtime: 0, size: 0 };
  }
  return { TFile: MockTFile };
});

describe('chat persistence', () => {
  it('발견 집계를 출처와 분리해 저장하고 손상된 집계만 제외한다', async () => {
    const inventory = [
      {
        query: 'synthetic term',
        totalDocuments: 5,
        totalChunks: 8,
        totalOccurrences: 12,
        documents: [{ sourcePath: 'synthetic/unreviewed.md', occurrences: 3 }],
      },
    ];
    const vault = createVault();
    const message = createMessage({
      role: 'assistant',
      content: '독립 합성 답변',
      indexedMatchInventory: inventory,
    });
    const file = await saveChat(vault, [message], 'Chats');
    const loaded = await loadChat(vault, file.path);
    expect(loaded.messages[0].indexedMatchInventory).toEqual(inventory);
    expect(loaded.messages[0].citations).toEqual(message.citations);
    const raw = await vault.cachedRead(file);
    await vault.modify(file, raw.replace('"totalDocuments": 5', '"totalDocuments": -1'));
    const damaged = await loadChat(vault, file.path);
    expect(damaged.messages[0].indexedMatchInventory).toBeUndefined();
    expect(damaged.messages[0].content).toBe(message.content);
  });

  it('단계별 검수 비용과 미완료 고지를 저장하고 복원한다', async () => {
    const vault = createVault();
    const phase = () => ({
      durationMs: 12,
      requests: 1,
      reportedRequests: 1,
      inputTokens: 20,
      outputTokens: 3,
      totalTokens: 23,
    });
    const indexedReviewDiagnostics = {
      phases: {
        inventory: phase(),
        search: phase(),
        map: phase(),
        screen: phase(),
        extract: phase(),
        reduce: phase(),
        answer: phase(),
      },
      counts: {
        candidateSegments: 12,
        screenAcceptedSegments: 4,
        extractedSegments: 4,
        screenRetries: 0,
        extractRetries: 1,
        splitBatches: 1,
        reduceRequests: 0,
        cacheHits: 2,
      },
    };
    const message = createMessage({
      role: 'assistant',
      content: '독립 합성 답변',
      indexedReviewDiagnostics,
      indexedReviewNotice: '독립 합성 미완료 고지',
    });
    const file = await saveChat(vault, [message], 'Chats');
    const loaded = await loadChat(vault, file.path);
    expect(loaded.messages[0].indexedReviewDiagnostics).toEqual(indexedReviewDiagnostics);
    expect(loaded.messages[0].indexedReviewNotice).toBe(message.indexedReviewNotice);
  });

  it('디버그 추적을 켜면 답변에 추적 문서를 남기고 불러온 본문은 그대로다', async () => {
    const vault = createVault();
    const messages = [
      createMessage({ id: 'msg-user', role: 'user', content: '합성 질의 본문' }),
      createMessage({ id: 'msg-answer', role: 'assistant', content: '합성 답변 본문' }),
    ];
    const file = await saveChat(vault, messages, 'Chats', undefined, {
      debugTrace: { enabled: true, config: traceConfig },
    });
    const raw = await vault.cachedRead(file);
    expect(raw).toContain(CHAT_DEBUG_TRACE_HEADING);

    const loaded = await loadChat(vault, file.path);
    expect(loaded.messages[1].content).toBe('합성 답변 본문');
    expect(loaded.messages[1].content).not.toContain('Debug Trace');

    const trace = extractChatDebugTrace(raw);
    expect(trace?.input.question).toBe('합성 질의 본문');
    expect(trace?.turn.messageId).toBe('msg-answer');
  });

  it('디버그 추적이 꺼져 있으면 추적 문서를 남기지 않는다', async () => {
    const vault = createVault();
    const file = await saveChat(
      vault,
      [createMessage({ role: 'assistant', content: '합성 답변 본문' })],
      'Chats',
      undefined,
      { debugTrace: { enabled: false, config: traceConfig } },
    );
    const raw = await vault.cachedRead(file);
    expect(raw).not.toContain(CHAT_DEBUG_TRACE_HEADING);
  });

  it('답변 저장은 본문·출처·근거 제한을 보존하고 기존 노트를 덮어쓰지 않는다', async () => {
    const vault = createVault();
    vault.writeFile('Notes/Comparison.md', '기존 사용자 노트');
    const message = createMessage({
      role: 'assistant',
      content: '확인한 자료에 한정한 비교입니다. [source-1]',
      citations: [
        {
          id: 'source-1',
          filePath: 'Examples/A.md',
          line: 2,
          preview: '합성 근거',
          status: 'verified',
        },
      ],
      sourceWarnings: [
        {
          id: 'missing',
          label: '일부 자료 누락',
          detail: '확인하지 못한 자료가 있습니다.',
          kind: 'unverified-source',
        },
      ],
    });
    const file = await saveAnswerNote(vault, message, 'Notes', 'Comparison');
    expect(file.path).toBe('Notes/Comparison-2.md');
    const content = await vault.cachedRead(file);
    expect(content).toContain(message.content);
    expect(content).toContain('Examples/A.md');
    expect(content).toContain('합성 근거');
    expect(content).toContain('확인하지 못한 자료가 있습니다.');
    expect(
      await vault.cachedRead(vault.getAbstractFileByPath('Notes/Comparison.md') as TFile),
    ).toBe('기존 사용자 노트');
  });

  it('답변은 루트에도 저장할 수 있고 저장 실패를 성공으로 반환하지 않는다', async () => {
    const vault = createVault();
    const message = createMessage({ role: 'assistant', content: '답변' });
    expect((await saveAnswerNote(vault, message, '', 'Answer')).path).toBe('Answer.md');
    vi.spyOn(vault, 'create').mockRejectedValueOnce(new Error('쓰기 실패'));
    await expect(saveAnswerNote(vault, message, '', 'Another')).rejects.toThrow('쓰기 실패');
    expect(message.content).toBe('답변');
  });
  it('목록은 실제 수정일의 최신순이며 읽기 순서로 바뀌지 않는다', async () => {
    const vault = createVault();
    vault.writeFile('Chats/old.md', '---\ncreated: "2026-01-01T00:00:00.000Z"\n---\n');
    vault.writeFile('Chats/new.md', '---\ncreated: "2026-02-01T00:00:00.000Z"\n---\n');
    vault.writeFile(
      'Chats/edited.md',
      '---\ncreated: "2025-01-01T00:00:00.000Z"\nupdated: "2026-03-01T00:00:00.000Z"\n---\n',
    );
    const expected = ['Chats/edited.md', 'Chats/new.md', 'Chats/old.md'];
    expect((await listChatMetasAsync(vault, 'Chats')).map((meta) => meta.filePath)).toEqual(
      expected,
    );
    await loadChat(vault, 'Chats/old.md');
    await loadChat(vault, 'Chats/new.md');
    expect((await listChatMetasAsync(vault, 'Chats')).map((meta) => meta.filePath)).toEqual(
      expected,
    );
  });

  it('저장된 채팅 목록은 Rust folder plan으로 폴더 내부 Markdown만 고른다', () => {
    const vault = createVault();
    vault.writeFile('Chats/a.md', 'a');
    vault.writeFile('Chats/Nested/b.md', 'b');
    vault.writeFile('Chats-extra/c.md', 'c');

    expect(listChats(vault, 'Chats').map((file) => file.path)).toEqual([
      'Chats/a.md',
      'Chats/Nested/b.md',
    ]);
  });

  it('base64 블록으로 저장해 sentinel 문자열이 포함된 메시지를 온전히 복원한다', async () => {
    const vault = createVault();
    const content = [
      '본문 시작',
      '<!-- superpower-inside-content-end -->',
      '<!-- superpower-inside-reasoning-end -->',
      '본문 끝',
    ].join('\n');
    const reasoning = '추론 <!-- superpower-inside-reasoning-end --> 포함';
    const errorMessage = '오류 <!-- superpower-inside-error-end --> 포함';
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content,
        reasoning,
        errorMessage,
        status: 'error',
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats', 'system prompt');
    const loaded = await loadChat(vault, file.path);

    expect(loaded.messages[0].content).toBe(content);
    expect(loaded.messages[0].reasoning).toBe(reasoning);
    expect(loaded.messages[0].errorMessage).toBe(errorMessage);
  });

  it('기존 super-obsidian raw sentinel 포맷 세션을 계속 로드한다', async () => {
    const vault = createVault();
    const legacyPath = 'Chats/legacy.md';
    const createdAt = '2026-05-16T00:00:00.000Z';
    const meta = {
      id: 'msg-legacy',
      role: 'user',
      timestamp: Date.parse(createdAt),
      createdAt,
      updatedAt: createdAt,
      status: 'complete',
    };
    vault.writeFile(
      legacyPath,
      [
        '---',
        'title: "Legacy"',
        'messages: 1',
        '---',
        '',
        '## Messages',
        '',
        '<!-- super-obsidian-message',
        JSON.stringify(meta, null, 2),
        '-->',
        '### 1. User',
        '',
        '<!-- super-obsidian-content-start -->',
        'legacy content',
        '<!-- super-obsidian-content-end -->',
        '<!-- /super-obsidian-message -->',
      ].join('\n'),
    );

    const loaded = await loadChat(vault, legacyPath);

    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0]).toMatchObject({
      id: 'msg-legacy',
      role: 'user',
      content: 'legacy content',
      status: 'complete',
    });
    expect(loaded.messages[0].errorRetryAt).toBeUndefined();
    expect(loaded.messages[0].usageSnapshot).toBeUndefined();
    expect(loaded.messages[0].retrievalTrace).toBeUndefined();
  });

  it('assistantQuestion 메타를 저장하고 복원한다', async () => {
    const vault = createVault();
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '',
        assistantQuestion: {
          prompt: '해당되는 항목을 모두 선택해 주세요.',
          choices: [
            { id: 'choice-1', label: '성능' },
            { id: 'choice-2', label: '보안' },
          ],
          selectionMode: 'multiple',
          allowFreeText: true,
          source: 'answer',
        },
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const loaded = await loadChat(vault, file.path);

    expect(loaded.messages[0].assistantQuestion).toEqual(messages[0].assistantQuestion);
  });

  it('assistantQuestion이 없는 legacy 세션은 undefined로 로드한다', async () => {
    const vault = createVault();
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '일반 답변',
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const loaded = await loadChat(vault, file.path);

    expect(loaded.messages[0].assistantQuestion).toBeUndefined();
  });

  it('single/freeText/reasoning-leak assistantQuestion 메타를 round-trip 한다', async () => {
    const vault = createVault();
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '',
        assistantQuestion: {
          prompt: '어떤 문서를 기준으로 할까요?',
          choices: [],
          selectionMode: 'single',
          allowFreeText: true,
          source: 'reasoning-leak',
        },
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const loaded = await loadChat(vault, file.path);

    expect(loaded.messages[0].assistantQuestion).toEqual(messages[0].assistantQuestion);
  });

  it('provider capability snapshot을 저장하고 복원한다', async () => {
    const vault = createVault();
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '답변',
        providerKey: 'customOpenAI:custom',
        providerLabel: 'Custom',
        model: 'custom-test',
        providerCapability: {
          providerKey: 'customOpenAI:custom',
          model: 'custom-test',
          streaming: false,
          transport: 'request-url-buffered',
          toolCalling: false,
          reasoning: false,
          abort: 'best-effort',
          fileReference: true,
          maxToolRounds: 0,
          knownLimitations: ['requestUrl 경로는 취소가 best-effort입니다.'],
        },
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const loaded = await loadChat(vault, file.path);

    expect(loaded.messages[0].providerCapability).toEqual(messages[0].providerCapability);
  });

  it('turn stage와 tool round를 저장하고 복원한다', async () => {
    const vault = createVault();
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '툴 결과를 기다리는 중',
        status: 'pending',
        turnStage: 'awaiting-tool-approval',
        toolRound: 2,
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const loaded = await loadChat(vault, file.path);

    expect(loaded.messages[0]).toMatchObject({
      status: 'pending',
      turnStage: 'awaiting-tool-approval',
      toolRound: 2,
    });
  });

  it('429 재시도 가능 시각을 저장하고 Rust parser를 거쳐 복원한다', async () => {
    const vault = createVault();
    const errorRetryAt = '2026-05-16T00:03:00.000Z';
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '현재 연결의 요청 한도에 도달했습니다.',
        status: 'error',
        errorKind: 'rate-limit',
        errorRetryAt,
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const loaded = await loadChat(vault, file.path);

    expect(loaded.messages[0].errorRetryAt).toBe(errorRetryAt);
  });

  it('schema v2 replay 필드와 redacted tool state를 저장하고 복원한다', async () => {
    const vault = createVault();
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '도구와 출처를 재생합니다.',
        status: 'error',
        errorMessage: 'provider failed',
        errorKind: 'tool-failed',
        stopReason: 'tool-failed',
        turnStage: 'error',
        toolRound: 2,
        branchOf: 'Chats/root.md',
        branchRoot: 'Chats/root.md',
        variantOf: 'msg-root',
        usageSnapshot: {
          requests: 3,
          reportedRequests: 2,
          partial: true,
          inputTokens: 200,
          outputTokens: 40,
          totalTokens: 240,
        },
        retrievalTrace: [
          {
            query: 'synthetic topic',
            diagnostics: [],
            results: [{ filePath: 'Synthetic.md', bm25Score: 2, vectorScore: 0.8 }],
          },
        ],
        contextBudgetSnapshot: {
          modelContext: planModelContextRust({ contextLength: 128000 })!,
          maxChars: 12_000,
          usedChars: 4_200,
          remainingChars: 7_800,
          attachmentCount: 2,
          citationCount: 1,
          truncated: false,
          includedAttachmentIds: ['rag:auto'],
          excludedAttachmentIds: ['mcp:search'],
        },
        dataBoundarySnapshot: {
          providerLabel: 'Ollama',
          model: 'llama3.1',
          localOnly: ['초안 저장소'],
          sentToProvider: ['첨부 컨텍스트 1개'],
          sentToMcp: ['search'],
          privacyNotes: ['제외된 attachment 1개는 provider 요청에 포함하지 않습니다.'],
        },
        toolRoundLogs: [
          {
            round: 1,
            toolCallIds: ['call-1'],
            status: 'error',
            startedAt: '2026-05-16T00:00:01.000Z',
            completedAt: '2026-05-16T00:00:02.000Z',
            errorMessage: 'ENOENT',
          },
        ],
        actionHistory: [
          {
            id: 'action-1',
            action: 'tool-approved',
            at: '2026-05-16T00:00:01.000Z',
            detail: '사용자가 실행을 승인했습니다.',
          },
        ],
        toolCalls: [
          {
            id: 'call-1',
            name: 'search_notes',
            arguments: '{"query":"alpha","apiKey":"secret-value"}',
            result: 'Authorization: Bearer secret-token\n검색 결과',
            status: 'error',
            serverName: 'local',
          },
        ],
        citations: [
          {
            id: 'rag-1',
            filePath: 'Notes/A.md',
            status: 'verified',
            preview: '근거',
          },
        ],
        sourceWarnings: [
          {
            id: 'warn-1',
            label: 'Source rag-9',
            detail: '검증된 citation 없음',
            kind: 'unverified-source',
          },
        ],
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const raw = await vault.cachedRead(file);
    const loaded = await loadChat(vault, file.path);

    expect(raw).toContain('"schemaVersion": 2');
    expect(raw).toContain('[REDACTED]');
    expect(raw).not.toContain('secret-value');
    expect(raw).not.toContain('secret-token');
    expect(loaded.messages[0]).toMatchObject({
      schemaVersion: 2,
      errorKind: 'tool-failed',
      branchOf: 'Chats/root.md',
      branchRoot: 'Chats/root.md',
      variantOf: 'msg-root',
      usageSnapshot: {
        requests: 3,
        reportedRequests: 2,
        partial: true,
        inputTokens: 200,
        outputTokens: 40,
        totalTokens: 240,
      },
      retrievalTrace: [
        {
          query: 'synthetic topic',
          diagnostics: [],
          results: [{ filePath: 'Synthetic.md', bm25Score: 2, vectorScore: 0.8 }],
        },
      ],
      contextBudgetSnapshot: {
        modelContext: planModelContextRust({ contextLength: 128000 })!,
        maxChars: 12_000,
        usedChars: 4_200,
        remainingChars: 7_800,
        attachmentCount: 2,
        citationCount: 1,
        truncated: false,
        includedAttachmentIds: ['rag:auto'],
        excludedAttachmentIds: ['mcp:search'],
      },
      dataBoundarySnapshot: {
        providerLabel: 'Ollama',
        model: 'llama3.1',
        localOnly: ['초안 저장소'],
        sentToProvider: ['첨부 컨텍스트 1개'],
        sentToMcp: ['search'],
        privacyNotes: ['제외된 attachment 1개는 provider 요청에 포함하지 않습니다.'],
      },
      toolRoundLogs: [
        expect.objectContaining({
          round: 1,
          toolCallIds: ['call-1'],
          status: 'error',
        }),
      ],
      actionHistory: [
        expect.objectContaining({
          action: 'tool-approved',
        }),
      ],
      toolCalls: [
        expect.objectContaining({
          arguments: '{"query":"alpha","apiKey":"[REDACTED]"}',
          resultSummary: 'Authorization: Bearer [REDACTED]\n검색 결과',
        }),
      ],
    });
  });

  it('대용량 normalizedResult는 저장하지 않고 감사용 도구 요약과 출처를 보존한다', async () => {
    const vault = createVault();
    const largeNormalizedResult = JSON.stringify({
      path: 'Notes/Large.md',
      content: '아주 긴 검색 본문'.repeat(8_000),
    });
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '검색 결과를 요약했습니다.',
        originalContent: '검색 결과를 요약했습니다.',
        toolCalls: [
          {
            id: 'call-large',
            name: 'superpower_inside',
            arguments: '{"action":"read","path":"Notes/Large.md"}',
            result: '문서 1개를 읽었습니다.',
            resultSummary: '문서 1개를 읽었습니다.',
            normalizedResult: largeNormalizedResult,
            status: 'success',
            serverName: 'Superpower Inside',
            approved: true,
            executionKind: 'native',
            citations: [
              {
                id: 'tool-source-1',
                filePath: 'Notes/Large.md',
                status: 'verified',
                preview: '근거 미리보기',
              },
            ],
          },
        ],
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const raw = await vault.cachedRead(file);
    const loaded = await loadChat(vault, file.path);

    expect(raw).not.toContain('"normalizedResult"');
    expect(raw).not.toContain('"result":');
    expect(raw).not.toContain('"originalContent"');
    expect(raw).not.toContain('아주 긴 검색 본문');
    expect(raw.length).toBeLessThan(10_000);
    expect(loaded.messages[0].content).toBe('검색 결과를 요약했습니다.');
    expect(loaded.messages[0].toolCalls).toEqual([
      {
        id: 'call-large',
        name: 'superpower_inside',
        arguments: '{"action":"read","path":"Notes/Large.md"}',
        resultSummary: '문서 1개를 읽었습니다.',
        resumePayloadSource: 'resultSummary',
        status: 'success',
        serverName: 'Superpower Inside',
        approved: true,
        executionKind: 'native',
        citations: [
          {
            id: 'tool-source-1',
            filePath: 'Notes/Large.md',
            status: 'verified',
            preview: '근거 미리보기',
          },
        ],
      },
    ]);
    const resumedMessages = appendAssistantToolRound(
      [{ role: 'user', content: '계속해줘' }],
      loaded.messages[0]?.content ?? '',
      loaded.messages[0]?.toolCalls ?? [],
    );
    expect(JSON.parse(resumedMessages[2]?.content ?? '')).toEqual({
      kind: 'tool-result-summary',
      summary: '문서 1개를 읽었습니다.',
      originalResultAvailable: false,
      sourceReferences: [
        {
          filePath: 'Notes/Large.md',
          status: 'verified',
          requiresRead: true,
        },
      ],
      sourceReferencesUntrustedMetadata: true,
    });
  });

  it('성공한 A와 승인 대기 B를 다시 열면 A의 compact 요약만 provider에 재주입한다', async () => {
    const vault = createVault();
    const largeNormalizedResult = JSON.stringify({
      content: `비밀 원문 ${'대용량 결과 '.repeat(8_000)}`,
    });
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '두 도구를 확인합니다.',
        toolCalls: [
          {
            id: 'call-a',
            name: 'search_notes',
            arguments: '{"query":"alpha"}',
            resultSummary: 'Authorization: Bearer secret-token\n검색 결과 3개',
            normalizedResult: largeNormalizedResult,
            status: 'success',
            approved: true,
          },
          {
            id: 'call-b',
            name: 'mcp_secondary_delete_note_deadbeef',
            arguments: '{"path":"Draft.md"}',
            status: 'running',
            serverName: 'secondary',
            actualToolName: 'delete_note',
            mcpBindingSource: 'catalog',
            approved: false,
          },
        ],
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const raw = await vault.cachedRead(file);
    const loaded = await loadChat(vault, file.path);
    await saveChat(vault, loaded.messages, 'Chats', undefined, { filePath: file.path });
    const rawAfterResumeSave = await vault.cachedRead(file);
    const resumedMessages = appendAssistantToolRound(
      [],
      loaded.messages[0].content,
      loaded.messages[0].toolCalls ?? [],
    );

    expect(raw).not.toContain('"normalizedResult"');
    expect(raw).not.toContain('"result":');
    expect(raw).not.toContain('secret-token');
    expect(raw).not.toContain('비밀 원문');
    expect(rawAfterResumeSave).not.toContain('"normalizedResult"');
    expect(rawAfterResumeSave).not.toContain('"result":');
    expect(rawAfterResumeSave).not.toContain('secret-token');
    expect(rawAfterResumeSave).not.toContain('비밀 원문');
    expect(loaded.messages[0].toolCalls?.[1]).toMatchObject({
      id: 'call-b',
      name: 'mcp_secondary_delete_note_deadbeef',
      serverName: 'secondary',
      actualToolName: 'delete_note',
      mcpBindingSource: 'catalog',
      approved: false,
    });
    expect(resumedMessages.map((message) => message.role)).toEqual(['assistant', 'tool']);
    expect(resumedMessages[1]).toMatchObject({
      tool_call_id: 'call-a',
      tool_result_is_error: false,
    });
    expect(JSON.parse(resumedMessages[1]?.content ?? '')).toEqual({
      kind: 'tool-result-summary',
      summary: 'Authorization: Bearer [REDACTED]\n검색 결과 3개',
      originalResultAvailable: false,
    });

    const callTool = vi.fn(() =>
      Promise.resolve({ content: [{ type: 'text', text: 'Draft.md 삭제 완료' }] }),
    );
    const listTools = vi.fn(() =>
      Promise.resolve([{ name: 'delete_note', inputSchema: { type: 'object' } }]),
    );
    const registry: MCPRegistryLike = {
      getConnectionStatus: (name) => (name === 'secondary' ? 'connected' : 'disconnected'),
      getEnabledServers: () => [{ name: 'secondary' }],
      getClient: (name) => (name === 'secondary' ? { listTools, callTool } : undefined),
    };
    const pendingCall = loaded.messages[0].toolCalls?.[1];
    if (!pendingCall) throw new Error('승인 대기 호출 복원 실패');
    const [executed] = await executeMcpToolCalls({
      registry,
      toolCalls: [{ ...pendingCall, approved: true }],
      preferredServerNames: ['secondary'],
    });

    expect(listTools).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith('delete_note', { path: 'Draft.md' });
    expect(executed).toMatchObject({
      name: 'mcp_secondary_delete_note_deadbeef',
      serverName: 'secondary',
      actualToolName: 'delete_note',
      mcpBindingSource: 'catalog',
      status: 'success',
    });
  });

  it('명시적 결과 요약이 없으면 도구 결과를 1,000자 이내 요약으로 저장한다', async () => {
    const vault = createVault();
    const messages: ChatMessageWithMeta[] = [
      createMessage({
        role: 'assistant',
        content: '도구 실행 완료',
        toolCalls: [
          {
            id: 'call-summary-fallback',
            name: 'superpower_inside',
            arguments: '{"action":"stats"}',
            normalizedResult: `요약 시작 ${'상세 결과 '.repeat(500)}`,
            status: 'success',
          },
        ],
      }),
    ];

    const file = await saveChat(vault, messages, 'Chats');
    const raw = await vault.cachedRead(file);
    const loaded = await loadChat(vault, file.path);
    const persistedToolCall = loaded.messages[0].toolCalls?.[0];

    expect(raw).not.toContain('"normalizedResult"');
    expect(persistedToolCall?.normalizedResult).toBeUndefined();
    expect(persistedToolCall?.resultSummary).toMatch(/^요약 시작 /);
    expect(persistedToolCall?.resultSummary).toHaveLength(1_000);
    expect(persistedToolCall?.resultSummary?.endsWith('…')).toBe(true);
  });

  it('기존 v2 세션의 전체 도구 결과 필드를 계속 로드한다', async () => {
    const vault = createVault();
    const createdAt = '2026-05-16T00:00:00.000Z';
    const legacyToolCall = {
      id: 'call-v2',
      name: 'superpower_inside',
      arguments: '{"action":"read","path":"Notes/Legacy.md"}',
      result: '과거 표시 결과',
      resultSummary: '과거 결과 요약',
      normalizedResult: '{"content":"과거 정규화 결과"}',
      status: 'success',
      citations: [
        {
          id: 'legacy-source',
          filePath: 'Notes/Legacy.md',
          preview: '과거 근거',
        },
      ],
    };
    const meta = {
      id: 'msg-v2',
      schemaVersion: 2,
      role: 'assistant',
      timestamp: Date.parse(createdAt),
      createdAt,
      updatedAt: createdAt,
      status: 'complete',
      toolCalls: [legacyToolCall],
    };
    vault.writeFile(
      'Chats/v2.md',
      [
        '---',
        'title: "V2"',
        'messages: 1',
        '---',
        '',
        '<!-- superpower-inside-message',
        JSON.stringify(meta, null, 2),
        '-->',
        '### 1. Assistant',
        '',
        '#### Answer',
        '',
        '<!-- superpower-inside-content-start encoding="base64" -->',
        encodeTestBlock('과거 답변'),
        '<!-- superpower-inside-content-end -->',
        '<!-- /superpower-inside-message -->',
      ].join('\n'),
    );

    const loaded = await loadChat(vault, 'Chats/v2.md');

    expect(loaded.messages[0].toolCalls).toEqual([legacyToolCall]);
  });
});

const traceConfig: ChatTraceConfigSnapshot = {
  rag: {
    chunkSize: 1000,
    overlap: 100,
    embeddingProvider: 'ternlight',
    embeddingModel: 'ternlight-base',
    minScore: 0.3,
    enableBM25: true,
    bm25Weight: 0.3,
    annEnabled: true,
    structuralGraphEnabled: true,
  },
  chat: {
    mcpToolExecutionPolicy: 'always-auto',
    mcpServerCount: 0,
    pluginAwareEnabled: false,
    autoSaveEnabled: true,
  },
};

interface TestVault extends Vault {
  writeFile(path: string, content: string): void;
}

function createVault(): TestVault {
  const files = new Map<string, { file: TFile; content: string }>();
  const folders = new Set<string>();
  const adapter: Pick<DataAdapter, 'exists'> = {
    exists: (path: string) => Promise.resolve(files.has(path) || folders.has(path)),
  };
  const vault = {
    adapter,
    createFolder: (path: string) => {
      folders.add(path);
      return Promise.resolve();
    },
    create: (path: string, content: string) => {
      const file = createTFile(path, content.length);
      files.set(path, { file, content });
      return Promise.resolve(file);
    },
    modify: (file: TFile, content: string) => {
      files.set(file.path, { file, content });
      return Promise.resolve();
    },
    cachedRead: (file: TFile) => Promise.resolve(files.get(file.path)?.content ?? ''),
    getAbstractFileByPath: (path: string) => files.get(path)?.file ?? null,
    getMarkdownFiles: () => [...files.values()].map((entry) => entry.file),
    writeFile: (path: string, content: string) => {
      const file = createTFile(path, content.length);
      files.set(path, { file, content });
    },
  };
  return vault as unknown as TestVault;
}

function createTFile(path: string, size: number): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  const name = path.split('/').pop() ?? path;
  Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.split('.').pop() ?? '',
    stat: { ctime: 0, mtime: 0, size },
  });
  return file;
}

function createMessage(
  overrides: Partial<ChatMessageWithMeta> & Pick<ChatMessageWithMeta, 'role' | 'content'>,
): ChatMessageWithMeta {
  const now = '2026-05-16T00:00:00.000Z';
  return {
    id: 'msg-test',
    timestamp: Date.parse(now),
    createdAt: now,
    updatedAt: now,
    status: 'complete',
    ...overrides,
  };
}

function encodeTestBlock(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

it('content가 비어 있고 reasoning이 있으면 로드 시 reasoning을 content로 폴백한다', async () => {
  const vault = createVault();
  const messages: ChatMessageWithMeta[] = [
    createMessage({
      role: 'assistant',
      content: '',
      reasoning: '생각의 과정입니다.',
    }),
  ];

  const file = await saveChat(vault, messages, 'Chats');
  const loaded = await loadChat(vault, file.path);

  expect(loaded.messages[0].content).toBe('생각의 과정입니다.');
  expect(loaded.messages[0].reasoning).toBe('생각의 과정입니다.');
});

it('originalContent가 있으면 저장 시 사용하고 로드 시 복원한다', async () => {
  const vault = createVault();
  const messages: ChatMessageWithMeta[] = [
    createMessage({
      role: 'assistant',
      content: '',
      originalContent: '원본 답변 내용',
      reasoning: '생각',
    }),
  ];

  const file = await saveChat(vault, messages, 'Chats');
  const loaded = await loadChat(vault, file.path);

  expect(loaded.messages[0].content).toBe('원본 답변 내용');
});

it('decodeTextBlock 실패 시 [decoding failed]를 반환한다', async () => {
  const vault = createVault();
  const badBase64 = '!!!invalid-base64!!!';
  const meta = {
    id: 'msg-bad',
    role: 'assistant',
    timestamp: Date.now(),
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    status: 'complete',
  };
  vault.writeFile(
    'Chats/bad.md',
    [
      '---',
      'title: "Bad"',
      'messages: 1',
      '---',
      '',
      '<!-- superpower-inside-message',
      JSON.stringify(meta, null, 2),
      '-->',
      '### 1. Assistant',
      '',
      '#### Answer',
      '',
      '<!-- superpower-inside-content-start encoding="base64" -->',
      badBase64,
      '<!-- superpower-inside-content-end -->',
      '<!-- /superpower-inside-message -->',
    ].join('\n'),
  );

  const loaded = await loadChat(vault, 'Chats/bad.md');
  expect(loaded.messages[0].content).toBe('[decoding failed]');
});
