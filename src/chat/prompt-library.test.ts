import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OBSIDIAN_PROMPT_ID,
  buildVaultPromptGenerationMessages,
  createDefaultPromptEntry,
  createPromptEntry,
  getDefaultObsidianSystemPrompt,
  getEffectiveSystemPrompt,
  normalizePromptLibrary,
  resetActivePromptToDefault,
  setActivePromptEntry,
  summarizeVectorEntries,
  updateActivePromptContent,
} from './prompt-library';
import type { VectorEntry } from '../rag/store';
import { setLanguage, t } from '../i18n';

afterEach(() => {
  setLanguage('ko');
});

describe('프롬프트 보관함', () => {
  it('빈 설정에는 Obsidian 기본 프롬프트를 보강한다', () => {
    const result = normalizePromptLibrary(undefined, undefined, '');

    expect(result.activePromptId).toBe(DEFAULT_OBSIDIAN_PROMPT_ID);
    expect(result.promptLibrary).toHaveLength(1);
    expect(result.promptLibrary[0]?.content).toBe(getDefaultObsidianSystemPrompt());
  });

  it('영어 기본 프롬프트는 레거시 사용자 프롬프트로 오인하지 않는다', () => {
    setLanguage('en');

    const result = normalizePromptLibrary([], undefined, t('defaultObsidianSystemPrompt'));

    expect(result.activePromptId).toBe(DEFAULT_OBSIDIAN_PROMPT_ID);
    expect(result.promptLibrary).toHaveLength(1);
    expect(result.promptLibrary[0]?.content).toBe(t('defaultObsidianSystemPrompt'));
  });

  it('편집하지 않은 기본 프롬프트는 현재 UI 언어로 다시 현지화한다', () => {
    setLanguage('ko');
    const storedDefault = createDefaultPromptEntry('2026-05-16T00:00:00.000Z');

    setLanguage('en');
    const result = normalizePromptLibrary(
      [storedDefault],
      DEFAULT_OBSIDIAN_PROMPT_ID,
      storedDefault.content,
    );

    expect(result.promptLibrary[0]).toMatchObject({
      id: DEFAULT_OBSIDIAN_PROMPT_ID,
      source: 'default',
      title: t('promptDefaultTitle'),
      content: t('defaultObsidianSystemPrompt'),
      createdAt: storedDefault.createdAt,
    });
    expect(/[가-힣]/u.test(result.promptLibrary[0]?.content ?? '')).toBe(false);
  });

  it('사용자가 편집한 기본 ID 프롬프트는 언어 전환 후에도 보존한다', () => {
    const editedDefault = {
      ...createDefaultPromptEntry('2026-05-16T00:00:00.000Z'),
      title: 'My vault policy',
      content: 'Always cite my notes.',
      source: 'user' as const,
    };

    setLanguage('en');
    const result = normalizePromptLibrary(
      [editedDefault],
      DEFAULT_OBSIDIAN_PROMPT_ID,
      editedDefault.content,
    );

    expect(result.promptLibrary[0]).toEqual(editedDefault);
  });

  it('기존 systemPrompt를 사용자 프롬프트 항목으로 보존한다', () => {
    const result = normalizePromptLibrary([], undefined, '기존 사용자 프롬프트');

    expect(result.activePromptId).toBe('legacy-user-system-prompt');
    expect(result.promptLibrary.map((entry) => entry.id)).toContain('legacy-user-system-prompt');
    expect(
      result.promptLibrary.find((entry) => entry.id === 'legacy-user-system-prompt')?.content,
    ).toBe('기존 사용자 프롬프트');
  });

  it('canonical 보관함이 있으면 systemPrompt mirror를 새 항목으로 합성하지 않는다', () => {
    const customEntry = {
      id: 'custom',
      title: 'Custom',
      content: '편집한 프롬프트',
      source: 'user' as const,
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };

    const result = normalizePromptLibrary([customEntry], customEntry.id, customEntry.content);

    expect(result.activePromptId).toBe(customEntry.id);
    expect(
      result.promptLibrary.filter((entry) => entry.content === customEntry.content),
    ).toHaveLength(1);
    expect(result.promptLibrary.find((entry) => entry.id === customEntry.id)).toMatchObject(
      customEntry,
    );
    expect(result.promptLibrary.map((entry) => entry.id)).not.toContain(
      'legacy-user-system-prompt',
    );
  });

  it('legacy-only 설정은 한 번 가져온 뒤 재정규화해도 항목을 중복 생성하지 않는다', () => {
    const migrated = normalizePromptLibrary(undefined, undefined, '기존 사용자 프롬프트');
    const reloaded = normalizePromptLibrary(
      migrated.promptLibrary,
      migrated.activePromptId,
      '기존 사용자 프롬프트',
    );

    expect(reloaded.activePromptId).toBe('legacy-user-system-prompt');
    expect(
      reloaded.promptLibrary.filter((entry) => entry.id === 'legacy-user-system-prompt'),
    ).toHaveLength(1);
  });

  it('삭제한 legacy 프롬프트는 남아 있는 systemPrompt mirror로 부활하지 않는다', () => {
    const migrated = normalizePromptLibrary(undefined, undefined, '삭제할 프롬프트');
    const remainingEntries = migrated.promptLibrary.filter(
      (entry) => entry.id !== 'legacy-user-system-prompt',
    );

    const reloaded = normalizePromptLibrary(
      remainingEntries,
      DEFAULT_OBSIDIAN_PROMPT_ID,
      '삭제할 프롬프트',
    );

    expect(reloaded.activePromptId).toBe(DEFAULT_OBSIDIAN_PROMPT_ID);
    expect(reloaded.promptLibrary).toHaveLength(1);
    expect(reloaded.promptLibrary[0]?.id).toBe(DEFAULT_OBSIDIAN_PROMPT_ID);
  });

  it('세션 프롬프트가 전역 보관함보다 우선한다', () => {
    const settings = createSettings({
      activePromptId: 'custom',
      promptLibrary: [
        {
          id: 'custom',
          title: 'Custom',
          content: '전역 프롬프트',
          source: 'user',
          createdAt: '2026-05-16T00:00:00.000Z',
          updatedAt: '2026-05-16T00:00:00.000Z',
        },
      ],
    });

    expect(getEffectiveSystemPrompt(settings, '세션 프롬프트')).toBe('세션 프롬프트');
    expect(getEffectiveSystemPrompt(settings, null)).toBe('전역 프롬프트');
  });

  it('기본 프롬프트를 직접 편집하면 사용자 프롬프트로 보존한다', () => {
    const defaultEntry = createDefaultPromptEntry('2026-05-16T00:00:00.000Z');
    const settings = createSettings({
      activePromptId: DEFAULT_OBSIDIAN_PROMPT_ID,
      promptLibrary: [defaultEntry],
    });

    updateActivePromptContent(settings, '내가 편집한 프롬프트', '2026-08-01T00:00:00.000Z');

    expect(settings.chat.promptLibrary[0]).toMatchObject({
      id: DEFAULT_OBSIDIAN_PROMPT_ID,
      source: 'user',
      content: '내가 편집한 프롬프트',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(getEffectiveSystemPrompt(settings, null)).toBe('내가 편집한 프롬프트');
  });

  it('사용자 프롬프트를 모두 지운 뒤 다시 입력해도 같은 항목을 계속 편집한다', () => {
    const entry = createPromptEntry({
      title: 'Custom',
      content: '기존 본문',
      source: 'user',
      now: '2026-08-01T00:00:00.000Z',
    });
    const settings = createSettings({
      activePromptId: entry.id,
      promptLibrary: [createDefaultPromptEntry(), entry],
    });

    updateActivePromptContent(settings, '', '2026-08-01T00:01:00.000Z');
    const reloaded = normalizePromptLibrary(
      settings.chat.promptLibrary,
      settings.chat.activePromptId,
      settings.chat.systemPrompt,
    );
    expect(reloaded.activePromptId).toBe(entry.id);
    expect(reloaded.promptLibrary.find((item) => item.id === entry.id)?.content).toBe('');
    updateActivePromptContent(settings, '새 본문', '2026-08-01T00:02:00.000Z');

    expect(settings.chat.activePromptId).toBe(entry.id);
    expect(settings.chat.promptLibrary.find((item) => item.id === entry.id)?.content).toBe(
      '새 본문',
    );
  });

  it('기본값 초기화는 편집된 기본 항목을 실제 내장 프롬프트로 교체한다', () => {
    const settings = createSettings({
      activePromptId: DEFAULT_OBSIDIAN_PROMPT_ID,
      systemPrompt: '내가 편집한 프롬프트',
      promptLibrary: [
        {
          ...createDefaultPromptEntry('2026-05-16T00:00:00.000Z'),
          source: 'user',
          content: '내가 편집한 프롬프트',
        },
      ],
    });

    resetActivePromptToDefault(settings, '2026-08-01T00:00:00.000Z');

    expect(settings.chat.activePromptId).toBe(DEFAULT_OBSIDIAN_PROMPT_ID);
    expect(settings.chat.systemPrompt).toBe('');
    expect(settings.chat.promptLibrary[0]).toMatchObject({
      id: DEFAULT_OBSIDIAN_PROMPT_ID,
      source: 'default',
      content: getDefaultObsidianSystemPrompt(),
      createdAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('활성 프롬프트 변경은 legacy systemPrompt mirror도 함께 갱신한다', () => {
    const settings = createSettings({});
    const entry = createPromptEntry({
      title: '새 기본값',
      content: '새 전역 프롬프트',
      source: 'user',
      now: '2026-08-01T00:00:00.000Z',
    });
    settings.chat.promptLibrary = [entry, ...settings.chat.promptLibrary];

    setActivePromptEntry(settings, entry);

    expect(settings.chat.activePromptId).toBe(entry.id);
    expect(settings.chat.systemPrompt).toBe(entry.content);
  });

  it('볼트 요약은 경로, 헤딩, 대표 샘플을 포함한다', () => {
    const summary = summarizeVectorEntries([
      createEntry('Projects/App.md', '결정 사항', '프로젝트 결정 내용'),
      createEntry('Research/Idea.md', '질문', '연구 질문 내용'),
    ]);

    expect(summary).toContain('총 청크: 2');
    expect(summary).toContain('Projects');
    expect(summary).toContain('결정 사항');
    expect(summary).toContain('프로젝트 결정 내용');
  });

  it('생성 메시지는 방향성 프리셋과 자유 지시를 포함한다', () => {
    const messages = buildVaultPromptGenerationMessages({
      entries: [createEntry('Note.md', '개요', '샘플 텍스트')],
      directionPreset: {
        id: 'research-notes',
        label: '연구 노트',
        instruction: '근거를 분리한다.',
      },
      directionText: '간결한 문체를 사용한다.',
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain('연구 노트');
    expect(messages[1]?.content).toContain('간결한 문체');
    expect(messages[1]?.content).toContain('Note.md');
  });
});

function createSettings(
  chat: Record<string, unknown>,
): Parameters<typeof getEffectiveSystemPrompt>[0] {
  return {
    chat: {
      saveFolder: 'Chats',
      defaultModel: 'ollama:llama3.1',
      systemPrompt: '',
      promptLibrary: [],
      mcpToolExecutionPolicy: 'mentioned-auto',
      autoSaveEnabled: true,
      autoSaveDebounceMs: 3000,
      enforceMcpTools: true,
      ...chat,
    },
  } as unknown as Parameters<typeof getEffectiveSystemPrompt>[0];
}

function createEntry(filePath: string, heading: string, text: string): VectorEntry {
  return {
    id: `${filePath}::0`,
    vector: [1, 0],
    metadata: {
      filePath,
      heading,
      startLine: 1,
      text,
    },
  };
}
