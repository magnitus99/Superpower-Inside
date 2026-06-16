import type { DataAdapter, Vault } from 'obsidian';
import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessageWithMeta } from './types';
import { listChats, loadChat, saveChat } from './persistence';

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
        contextBudgetSnapshot: {
          maxChars: 12_000,
          usedChars: 4_200,
          attachmentCount: 2,
          citationCount: 1,
          truncated: false,
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
      contextBudgetSnapshot: {
        maxChars: 12_000,
        usedChars: 4_200,
        attachmentCount: 2,
        citationCount: 1,
        truncated: false,
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
          result: 'Authorization: Bearer [REDACTED]\n검색 결과',
        }),
      ],
    });
  });
});

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
