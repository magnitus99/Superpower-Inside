import { describe, expect, it } from 'vitest';
import type { SourceCitation } from '../chat/types';
import { selectAnswerCitations, selectDisplayedAnswerCitations } from './citation-selection';

describe('최종 답변 citation 선택', () => {
  it('답변에서 실제 언급한 citation만 보존한다', () => {
    const citations = [
      citation('vault:Alpha.md:1-1'),
      citation('vault:Alpha.md:1-10'),
      citation('vault:Beta.md:2-4'),
    ];

    expect(
      selectAnswerCitations('근거 [vault:Alpha.md:1-10]과 vault:Beta.md:2-4', citations),
    ).toEqual([citations[1], citations[2]]);
  });

  it('모델이 citation id를 빠뜨리면 검증된 근거를 제한된 수만 반환한다', () => {
    const citations = Array.from({ length: 20 }, (_, index) => citation(`vault:${index}.md:1-1`));

    expect(selectAnswerCitations('출처 표기가 없는 최종 요약', citations)).toHaveLength(4);
  });

  it('답변에 언급된 파일 경로만 출처 카드로 남긴다', () => {
    const citations = [
      citation('vault:Bible/Genesis.md:1-10'),
      citation('vault:People/Neville.md:2-8'),
      citation('vault:Archive/Other.md:1-1'),
    ];

    expect(
      selectAnswerCitations(
        '`Bible/Genesis.md`와 People/Neville.md를 근거로 확인했습니다.',
        citations,
      ),
    ).toEqual([citations[0], citations[1]]);
  });

  it('근거 표기가 없는 답변에서 fallback을 끄면 임의 출처를 붙이지 않는다', () => {
    const citations = [citation('vault:Alpha.md:1-10'), citation('vault:Beta.md:2-4')];

    expect(selectAnswerCitations('출처 표기가 없는 답변', citations, 0)).toEqual([]);
  });

  it('사용자 표시 답변은 무표기 fallback 없이 실제 언급한 id와 경로만 남긴다', () => {
    const citations = [
      citation('vault:Alpha.md:1-10'),
      citation('vault:Notes/Beta.md:2-4'),
      citation('vault:Gamma.md:3-5'),
    ];

    expect(selectDisplayedAnswerCitations('출처 표기가 없는 답변', citations)).toEqual([]);
    expect(
      selectDisplayedAnswerCitations(
        '`Notes/Beta.md`와 [vault:Gamma.md:3-5]에서 확인했습니다.',
        citations,
      ),
    ).toEqual([citations[1], citations[2]]);
  });
});

function citation(id: string): SourceCitation {
  return {
    id,
    filePath: id.slice('vault:'.length).split(':')[0] ?? '',
    preview: id,
    status: 'verified',
  };
}
