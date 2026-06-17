import { describe, expect, it } from 'vitest';

import {
  createGraphEntityLabels,
  getEntityDisplayAliases,
  getEntitySearchAliases,
  hasCrossLanguageGraphEntityLabelPair,
  inferGraphEntityLabelLanguage,
  mergeGraphEntityLabels,
  type GraphEntityLabelCarrier,
} from './entity-labels';

describe('Graph entity labels', () => {
  it('canonical 이름과 alias를 언어 태그가 있는 label metadata로 만든다', () => {
    expect(
      createGraphEntityLabels({
        canonicalName: 'Paul',
        aliases: ['바울', 'Παῦλος', 'Paul'],
        confidence: 0.91,
        evidenceId: 'evidence::1',
        source: 'llm-extraction',
      }),
    ).toEqual([
      {
        value: 'Paul',
        language: 'en',
        kind: 'preferred',
        source: 'llm-extraction',
        confidence: 0.91,
        evidenceIds: ['evidence::1'],
      },
      {
        value: '바울',
        language: 'ko',
        kind: 'alias',
        source: 'llm-extraction',
        confidence: 0.91,
        evidenceIds: ['evidence::1'],
      },
      {
        value: 'Παῦλος',
        language: 'el',
        kind: 'alias',
        source: 'llm-extraction',
        confidence: 0.91,
        evidenceIds: ['evidence::1'],
      },
      {
        value: 'Paul',
        language: 'en',
        kind: 'alias',
        source: 'llm-extraction',
        confidence: 0.91,
        evidenceIds: ['evidence::1'],
      },
    ]);
  });

  it('동일 label은 confidence, source, evidence를 보수적으로 병합한다', () => {
    expect(
      mergeGraphEntityLabels(
        [
          {
            value: '바울',
            language: 'ko',
            kind: 'alias',
            source: 'llm-extraction',
            confidence: 0.7,
            evidenceIds: ['evidence::1'],
          },
        ],
        [
          {
            value: ' 바울 ',
            language: 'ko',
            kind: 'alias',
            source: 'manual',
            confidence: 1,
            evidenceIds: ['evidence::2'],
          },
        ],
      ),
    ).toEqual([
      {
        value: '바울',
        language: 'ko',
        kind: 'alias',
        source: 'manual',
        confidence: 1,
        evidenceIds: ['evidence::1', 'evidence::2'],
      },
    ]);
  });

  it('structured label은 검색 alias와 표시 alias에 legacy alias 없이도 포함된다', () => {
    const entity: GraphEntityLabelCarrier = {
      canonicalName: 'Paul',
      aliases: [],
      labels: [
        {
          value: 'Paul',
          language: 'en',
          kind: 'preferred',
          source: 'llm-extraction',
          confidence: 0.9,
          evidenceIds: ['evidence::1'],
        },
        {
          value: '바울',
          language: 'ko',
          kind: 'alias',
          source: 'manual',
          confidence: 1,
          evidenceIds: [],
        },
      ],
    };

    expect(getEntitySearchAliases(entity)).toEqual(['바울']);
    expect(getEntityDisplayAliases(entity)).toEqual(['바울']);
  });

  it('주요 문자권은 cross-language semantic-only merge guard에 사용할 수 있게 분류한다', () => {
    expect(inferGraphEntityLabelLanguage('바울')).toBe('ko');
    expect(inferGraphEntityLabelLanguage('Paul')).toBe('en');
    expect(inferGraphEntityLabelLanguage('パウロ')).toBe('ja');
    expect(inferGraphEntityLabelLanguage('保罗')).toBe('zh');
    expect(inferGraphEntityLabelLanguage('Павел')).toBe('cyrillic');
    expect(inferGraphEntityLabelLanguage('بولس')).toBe('ar');
    expect(inferGraphEntityLabelLanguage('פאולוס')).toBe('he');
    expect(inferGraphEntityLabelLanguage('Παῦλος')).toBe('el');
    expect(inferGraphEntityLabelLanguage('पौलुस')).toBe('hi');
    expect(inferGraphEntityLabelLanguage('เปาโล')).toBe('th');
  });

  it('언어권이 다르고 exact label이 없으면 cross-language 후보로 본다', () => {
    expect(hasCrossLanguageGraphEntityLabelPair(['Grace'], ['은혜'])).toBe(true);
    expect(hasCrossLanguageGraphEntityLabelPair(['Paul', '바울'], ['Paul'])).toBe(false);
  });
});
