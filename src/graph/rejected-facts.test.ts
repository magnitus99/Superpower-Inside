import { describe, expect, it } from 'vitest';
import type { GraphRejectedFactRecord } from './store';
import {
  buildRejectedFactCopyText,
  getRejectedFactPresentation,
} from './rejected-facts';

describe('GraphRAG rejected fact diagnostics', () => {
  it('invalid-json 실패를 공유 가능한 오류 코드와 납득 가능한 설명으로 변환한다', () => {
    const fact = createRejectedFact({
      reason: 'invalid-json',
      rawFact: 'I cannot produce JSON for this request.',
    });

    const presentation = getRejectedFactPresentation(fact);

    expect(presentation.errorCode).toBe('SPI-GRAPH-JSON-001');
    expect(presentation.title).toBe('LLM 응답을 JSON으로 파싱할 수 없음');
    expect(presentation.description).toContain('GraphRAG 추출 스키마');
    expect(presentation.rawPreview).toContain('I cannot produce JSON');
  });

  it('복사 텍스트에 파일, entry, 오류 코드, 원본 응답을 포함한다', () => {
    const fact = createRejectedFact({
      reason: 'invalid-json',
      rawFact: { message: 'not json', provider: 'openrouter' },
    });

    const copyText = buildRejectedFactCopyText(fact);

    expect(copyText).toContain('errorCode: SPI-GRAPH-JSON-001');
    expect(copyText).toContain('filePath: bible/test.md');
    expect(copyText).toContain('entryId: bible/test.md::1::0');
    expect(copyText).toContain('"provider": "openrouter"');
  });

  it('schema shape 불일치는 JSON 파싱 오류와 다른 코드로 표시한다', () => {
    const fact = createRejectedFact({
      reason: 'schema-shape-mismatch',
      rawFact: {
        entities: [{ id: 'Base', type: 'work', name: 'Base' }],
        relations: [{ source: 'Base', target: '표', type: 'part_of' }],
        claims: [{ subject: 'Base', claim: 'Base contains 표.', type: 'factual_claim' }],
      },
    });

    const presentation = getRejectedFactPresentation(fact);

    expect(presentation.errorCode).toBe('SPI-GRAPH-SCHEMA-SHAPE-001');
    expect(presentation.title).toBe('JSON 구조가 GraphRAG 추출 스키마와 다름');
    expect(presentation.description).toContain('relations.relationTypeId');
  });
});

function createRejectedFact(
  overrides: Partial<GraphRejectedFactRecord> = {},
): GraphRejectedFactRecord {
  return {
    id: 'reject-1',
    filePath: 'bible/test.md',
    entryId: 'bible/test.md::1::0',
    reason: 'invalid-json',
    rawFact: 'not-json',
    updatedAt: 1_800_000_000_000,
    ...overrides,
  };
}
