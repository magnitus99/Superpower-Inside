import { describe, expect, it } from 'vitest';
import {
  createCitationSectionView,
  createContextAttachmentChipViews,
  createSourceWarningViews,
} from './source-panel';
import type { ContextAttachment, SourceCitation, SourceValidationWarning } from './types';

describe('SourcePanel view model contract', () => {
  it('검증된 citation 수와 카드 메타를 계산한다', () => {
    const citations: SourceCitation[] = [
      {
        id: 'rag-1',
        filePath: 'Notes/A.md',
        heading: '개요',
        line: 3,
        score: 0.8123,
        status: 'verified',
        preview: '근거 내용',
      },
      {
        id: 'rag-2',
        filePath: 'Notes/B.md',
        status: 'missing',
        detail: '파일 없음',
        preview: '후보 내용',
      },
    ];

    expect(createCitationSectionView(citations)).toEqual({
      labelText: '검색 근거 1/2개 검증',
      cards: [
        expect.objectContaining({
          id: 'rag-1',
          className: 'superpower-inside-chat-citation-card verified',
          filePath: 'Notes/A.md',
          headingText: ' # 개요',
          metaText: 'line 3 · score 0.812 · status verified',
        }),
        expect.objectContaining({
          id: 'rag-2',
          className: 'superpower-inside-chat-citation-card missing',
          detail: '파일 없음',
        }),
      ],
    });
  });

  it('source warning과 context attachment chip 모델을 계산한다', () => {
    const warnings: SourceValidationWarning[] = [
      {
        id: 'warn-1',
        label: 'Source rag-9',
        detail: '검증된 citation이 없습니다.',
        kind: 'unverified-source',
      },
    ];
    const attachments: ContextAttachment[] = [
      {
        id: 'ctx-1',
        type: 'file',
        name: 'A.md',
        label: 'A.md',
        status: 'attached',
        detail: '현재 파일',
      },
    ];

    expect(createSourceWarningViews(warnings)).toEqual([
      {
        id: 'warn-1',
        className: 'superpower-inside-chat-source-warning unverified-source',
        label: 'Source rag-9',
        detail: '검증된 citation이 없습니다.',
        repairActionText: '출처 보정',
      },
    ]);
    expect(createContextAttachmentChipViews(attachments)).toEqual([
      {
        id: 'ctx-1',
        className: 'superpower-inside-chat-context-chip file attached',
        label: 'A.md',
        title: '현재 파일',
      },
    ]);
  });
});
