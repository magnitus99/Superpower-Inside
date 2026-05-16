import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OBSIDIAN_PROMPT_ID,
  DEFAULT_OBSIDIAN_SYSTEM_PROMPT,
  buildVaultPromptGenerationMessages,
  getEffectiveSystemPrompt,
  normalizePromptLibrary,
  summarizeVectorEntries,
} from './prompt-library';
import type { VectorEntry } from '../rag/store';

describe('프롬프트 보관함', () => {
  it('빈 설정에는 Obsidian 기본 프롬프트를 보강한다', () => {
    const result = normalizePromptLibrary(undefined, undefined, '');

    expect(result.activePromptId).toBe(DEFAULT_OBSIDIAN_PROMPT_ID);
    expect(result.promptLibrary).toHaveLength(1);
    expect(result.promptLibrary[0]?.content).toBe(DEFAULT_OBSIDIAN_SYSTEM_PROMPT);
  });

  it('기존 systemPrompt를 사용자 프롬프트 항목으로 보존한다', () => {
    const result = normalizePromptLibrary([], undefined, '기존 사용자 프롬프트');

    expect(result.activePromptId).toBe('legacy-user-system-prompt');
    expect(result.promptLibrary.map((entry) => entry.id)).toContain('legacy-user-system-prompt');
    expect(
      result.promptLibrary.find((entry) => entry.id === 'legacy-user-system-prompt')?.content,
    ).toBe('기존 사용자 프롬프트');
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

function createSettings(chat: Record<string, unknown>): Parameters<typeof getEffectiveSystemPrompt>[0] {
  return ({
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
  } as unknown) as Parameters<typeof getEffectiveSystemPrompt>[0];
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
