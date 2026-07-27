import { describe, expect, it } from 'vitest';
import { validateAnswerSources } from './source-validation';
import type { SourceCitation } from './types';

describe('validateAnswerSources', () => {
  it('assistant 답변의 없는 wikilink를 미검증 링크로 표시한다', () => {
    const warnings = validateAnswerSources('참고: [[없는 문서]]', [], {
      exists: () => false,
    });

    expect(warnings).toEqual([
      expect.objectContaining({
        label: '[[없는 문서]]',
        kind: 'missing-link',
      }),
    ]);
  });

  it('검증된 citation의 파일 링크는 경고하지 않는다', () => {
    const citations: SourceCitation[] = [
      {
        id: 'rag-1',
        filePath: 'Notes/Existing.md',
        status: 'verified',
        preview: '내용',
      },
    ];

    const warnings = validateAnswerSources('참고: [[Existing]] Source rag-1', citations, {
      exists: () => false,
    });

    expect(warnings).toEqual([]);
  });

  it('검증된 citation에 없는 Source ID를 경고한다', () => {
    const warnings = validateAnswerSources('Source rag-9에 따르면...', [], {
      exists: () => true,
    });

    expect(warnings).toEqual([
      expect.objectContaining({
        label: 'Source rag-9',
        kind: 'unverified-source',
      }),
    ]);
  });

  it('source validation input plan은 verified citation과 alias probe를 Rust에서 만든다', () => {
    const citations: SourceCitation[] = [
      {
        id: 'rag-1',
        filePath: 'Notes/Existing.md',
        status: 'verified',
        preview: '내용',
      },
      {
        id: 'rag-2',
        filePath: 'Draft.md',
        status: 'missing',
        preview: '',
      },
    ];
    const checkedPaths: string[] = [];

    const warnings = validateAnswerSources(
      '참고 [[Existing]] 및 [[Missing]] Source rag-2',
      citations,
      {
        exists: (path) => {
          checkedPaths.push(path);
          return path === 'Existing.md' || path === 'Missing.md';
        },
      },
    );

    expect(checkedPaths).toEqual(['Existing', 'Existing.md', 'Missing', 'Missing.md']);
    expect(warnings).toEqual([
      expect.objectContaining({
        label: 'Source rag-2',
        kind: 'unverified-source',
      }),
    ]);
  });
});
