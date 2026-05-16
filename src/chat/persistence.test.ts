import type { DataAdapter, Vault } from 'obsidian';
import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessageWithMeta } from './types';
import { loadChat, saveChat } from './persistence';

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
