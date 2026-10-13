import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  createContextPreviewChips,
  createLiveContextPreviewChips,
  createComposerDraftSnapshot,
  createComposerLoadingState,
  resolveComposerKeyAction,
  resolveComposerMentionTrigger,
} from './chat-composer';

describe('ChatComposer state contract', () => {
  it('@는 공백에서 멈추고 [[링크]]는 닫는 괄호까지 경로를 찾는다', () => {
    expect(resolveComposerMentionTrigger('요약해줘 @Note')).toEqual({
      mode: 'at',
      query: 'note',
      startIndex: 5,
    });
    expect(resolveComposerMentionTrigger('요약해줘 @Project Plan')).toBeNull();
    expect(resolveComposerMentionTrigger('요약해줘 [[monithub 개요.pdf')).toEqual({
      mode: 'wiki',
      query: 'monithub 개요.pdf',
      startIndex: 5,
    });
    expect(resolveComposerMentionTrigger('요약해줘 [[monithub 개요.pdf]] ')).toBeNull();
    expect(resolveComposerMentionTrigger('요약해줘 [[폴더 이름')).toEqual({
      mode: 'wiki',
      query: '폴더 이름',
      startIndex: 5,
    });
  });

  it('[[링크]] 미리보기는 실제 경로와 폴더·누락 상태를 함께 보여준다', () => {
    const resolver = {
      isFile: () => false,
      isFolder: () => false,
      isServer: () => false,
      resolveLink: (target: string) => {
        if (target === 'monithub 개요.pdf') return { type: 'file' as const, path: target };
        if (target === 'Projects/Alpha/') return { type: 'folder' as const, path: 'Projects/Alpha' };
        return null;
      },
    };
    const chips = createLiveContextPreviewChips(
      '[[monithub 개요.pdf]] ![[Projects/Alpha/]] [[없는 문서]]',
      resolver,
    );
    expect(chips).toContainEqual(
      expect.objectContaining({
        label: '[[monithub 개요.pdf]]',
        cls: 'file',
        paths: ['monithub 개요.pdf'],
        valid: true,
      }),
    );
    expect(chips).toContainEqual(
      expect.objectContaining({
        label: '![[Projects/Alpha/]]',
        cls: 'folder',
        paths: ['Projects/Alpha'],
        valid: true,
      }),
    );
    expect(chips).toContainEqual(
      expect.objectContaining({ label: '[[없는 문서]]', cls: 'missing', valid: false }),
    );
  });

  it('태그 참조는 일치 문서 수·경로와 빈 범위를 미리 보여준다', () => {
    const chips = createLiveContextPreviewChips('@#연구 @#missing', {
      isFile: () => true,
      isFolder: () => false,
      isServer: () => false,
      tagFiles: (tag) => (tag === '#연구' ? ['Notes/A.md', 'Notes/B.md'] : []),
    });
    expect(chips).toContainEqual(
      expect.objectContaining({
        label: '@#연구',
        cls: 'tag',
        paths: ['Notes/A.md', 'Notes/B.md'],
        valid: true,
        detail: '하위 태그 포함 · 문서 2개',
      }),
    );
    expect(chips).toContainEqual(expect.objectContaining({ label: '@#missing', valid: false }));
  });
  it('붙여넣은 참조의 실제 경로와 빈 작업공간·누락 경로 상태를 즉시 표시한다', () => {
    const chips = createLiveContextPreviewChips('@current @tabs @[없는 폴더/문서.md] @Notes', {
      workspaceFiles: { current: ['Notes/A.md'], tabs: [] },
      isFile: (name) => name === 'Notes/A.md',
      isFolder: (name) => name === 'Notes',
      isServer: () => false,
    });
    expect(chips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '@current · 현재 문서',
          paths: ['Notes/A.md'],
          valid: true,
        }),
        expect.objectContaining({
          label: '@tabs · 열린 문서 0개',
          valid: false,
          detail: '열린 문서가 없습니다.',
        }),
        expect.objectContaining({
          label: '@[없는 폴더/문서.md]',
          valid: false,
          detail: '찾을 수 없음',
        }),
        expect.objectContaining({ cls: 'folder', valid: true, paths: ['Notes'] }),
      ]),
    );
  });
  it('loading 상태에서는 중지 버튼과 입력 잠금을 계산한다', () => {
    expect(createComposerLoadingState(true)).toEqual({
      isStreaming: true,
      sendButton: { disabled: false, text: '중단' },
      inputDisabled: true,
      toolsDisabled: true,
      modelSelectDisabled: true,
      runControl: { hidden: false, statusText: '답변 작업 중', stopText: '전체 중단' },
    });
  });

  it('삭제된 문서가 작업공간에 남아 있어도 사용 가능으로 표시하지 않는다', () => {
    const chips = createLiveContextPreviewChips('@current', {
      workspaceFiles: { current: ['삭제된.md'], tabs: [] },
      isFile: () => false,
      isFolder: () => false,
      isServer: () => false,
    });
    expect(chips).toContainEqual(
      expect.objectContaining({
        valid: false,
        detail: '찾을 수 없음',
        paths: ['삭제된.md'],
      }),
    );
  });

  it('idle 상태에서는 전송 버튼과 입력 가능 상태를 계산한다', () => {
    expect(createComposerLoadingState(false)).toEqual({
      isStreaming: false,
      sendButton: { disabled: false, text: '전송' },
      inputDisabled: false,
      toolsDisabled: false,
      modelSelectDisabled: false,
      runControl: { hidden: true, statusText: '답변 작업 중', stopText: '전체 중단' },
    });
  });

  it('keyboard 계약을 send/newline/mention/cancel로 분리한다', () => {
    expect(resolveComposerKeyAction({ key: 'Enter' })).toBe('send');
    expect(resolveComposerKeyAction({ key: 'Enter', shiftKey: true })).toBe('newline');
    expect(resolveComposerKeyAction({ key: 'Enter', metaKey: true })).toBe('force-send');
    expect(resolveComposerKeyAction({ key: 'Escape', isStreaming: true })).toBe('cancel');
    expect(resolveComposerKeyAction({ key: 'ArrowDown', mentionOpen: true })).toBe('select-next');
    expect(resolveComposerKeyAction({ key: 'Tab', mentionOpen: true })).toBe('confirm-mention');
  });

  it('전송 실패/취소 복구용 draft snapshot을 만든다', () => {
    expect(
      createComposerDraftSnapshot({
        text: '@Notes/A.md 질문',
        attachmentIds: ['file:Notes/A.md'],
        now: '2026-05-16T00:00:00.000Z',
      }),
    ).toEqual({
      text: '@Notes/A.md 질문',
      attachmentIds: ['file:Notes/A.md'],
      updatedAt: '2026-05-16T00:00:00.000Z',
      hasContext: true,
    });
  });

  it('context preview chips use work language instead of transport acronyms', () => {
    setLanguage('en');

    expect(
      createContextPreviewChips([
        { type: 'server', name: 'search' },
        { type: 'folder', name: 'Research' },
        { type: 'file', name: 'Notes/A.md' },
      ]),
    ).toEqual([
      { label: 'Related notes', cls: 'rag' },
      { label: 'Tool search', cls: 'server' },
      { label: 'Folder Research', cls: 'folder' },
      { label: 'File Notes/A.md', cls: 'file' },
    ]);

    setLanguage('ko');
  });
});
