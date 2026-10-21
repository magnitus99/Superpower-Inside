import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, isLocalizedValue, resolveUiLanguage, setLanguage, t } from './i18n';

afterEach(() => {
  setLanguage('en');
});

describe('UI 언어 계약', () => {
  it.each(['ko', 'en'] as const)('%s 근거 전용 안내와 MCP 전용 경계를 제공한다', (lang) => {
    setLanguage(lang);
    expect(t('indexedReviewEvidenceOnly')).not.toBe('indexedReviewEvidenceOnly');
    expect(t('indexedReviewEvidenceOnly')).toMatch(
      lang === 'ko' ? /원문 근거/ : /original evidence/,
    );
    expect(t('llmVaultInvestigationWorkflow')).toContain('MCP');
    expect(t('llmVaultInvestigationWorkflow')).not.toContain('superpower_inside_search');
  });

  it.each(['ko', 'en'] as const)(
    '%s 검토 안내는 영향을 먼저 두고 범위를 뒤에서 설명한다',
    (lang) => {
      setLanguage(lang);
      const expectedCopy =
        lang === 'ko'
          ? ([
              ['indexedReviewCoverage', '검토 참고'],
              ['indexedReviewIncompleteNotice', '답변에 반영되지 않았습니다'],
              ['indexedReviewLimitedNotice', '근거 예산'],
              ['indexedReviewEvidenceOnly', '원문 근거를 먼저 보여 드립니다'],
              [
                'indexedReviewNoEvidence',
                '이번 검색에서는 질문과 직접 일치하는 원문 근거를 찾지 못했습니다',
              ],
              ['indexedReviewComparisonMissing', '이번 검토 범위에서는'],
              ['indexedReviewComparisonSearchFailed', '비교 범위가 일부 비어 있습니다'],
              [
                'searchStatusTruncated',
                '색인 문서 {total}개를 검색한 뒤 원문 확인을 통과한 결과만 표시합니다',
              ],
              [
                'llmIndexedReviewAnswer',
                '지원되는 결론을 먼저 자연스럽게 쓰고, 범위·불확실성 안내는 결론 뒤에 짧게 덧붙이세요.',
              ],
            ] as const)
          : ([
              ['indexedReviewCoverage', 'Review note'],
              ['indexedReviewIncompleteNotice', 'not reflected in the answer'],
              ['indexedReviewLimitedNotice', 'evidence budget'],
              ['indexedReviewEvidenceOnly', 'Verified original evidence is shown below'],
              [
                'indexedReviewNoEvidence',
                'This search did not find an original passage that directly supports the question',
              ],
              ['indexedReviewComparisonMissing', 'in the reviewed scope'],
              ['indexedReviewComparisonSearchFailed', 'comparison is only partly covered'],
              [
                'searchStatusTruncated',
                'After searching {total} indexed documents, only results that pass source checks are shown',
              ],
              [
                'llmIndexedReviewAnswer',
                'State supported conclusions naturally first, then add a brief note about scope or uncertainty after the conclusion.',
              ],
            ] as const);
      for (const [key, fragment] of expectedCopy) {
        expect(t(key)).toContain(fragment);
      }
    },
  );

  it.each(['ko', 'en'] as const)('%s 검토 문구의 변수 자리표시자를 모두 보존한다', (lang) => {
    setLanguage(lang);
    const reviewPlaceholders = [
      'total',
      'accepted',
      'machineExcluded',
      'rejected',
      'budgetExcluded',
      'unreviewed',
      'notIndexed',
      'unreadable',
    ] as const;
    for (const key of [
      'indexedReviewCoverage',
      'indexedReviewIncompleteNotice',
      'indexedReviewLimitedNotice',
    ] as const) {
      for (const placeholder of reviewPlaceholders) {
        expect(t(key)).toContain('{' + placeholder + '}');
      }
    }
    for (const [key, placeholders] of [
      ['indexedReviewComparisonMissing', ['facets']],
      ['indexedReviewComparisonSearchFailed', ['facets']],
      ['searchStatusTruncated', ['total', 'candidate', 'selected']],
    ] as const) {
      for (const placeholder of placeholders) {
        expect(t(key)).toContain('{' + placeholder + '}');
      }
    }
  });

  it('저장된 언어가 없으면 Obsidian 호스트 언어를 지원 언어로 정규화한다', () => {
    expect(resolveUiLanguage(undefined, 'ko-KR')).toBe('ko');
    expect(resolveUiLanguage(undefined, 'en-US')).toBe('en');
    expect(resolveUiLanguage(undefined, 'fr')).toBe('en');
  });

  it('사용자가 저장한 언어는 호스트 언어보다 우선한다', () => {
    expect(resolveUiLanguage('ko', 'en')).toBe('ko');
    expect(resolveUiLanguage('en', 'ko')).toBe('en');
  });

  it('영어 Provider 탭의 핵심 명칭에 한글이 섞이지 않는다', () => {
    setLanguage('en');

    expect(getLanguage()).toBe('en');
    expect(t('tabProviders')).toBe('AI connections');
    expect(t('providerNewName')).toBe('New provider');
    expect(/[가-힣]/u.test(`${t('tabProviders')} ${t('providerNewName')}`)).toBe(false);
  });

  it('양쪽 언어의 자동 생성 기본값을 식별한다', () => {
    expect(isLocalizedValue('providerNewName', '새 프로바이더')).toBe(true);
    expect(isLocalizedValue('providerNewName', 'New provider')).toBe(true);
    expect(isLocalizedValue('providerNewName', 'Research endpoint')).toBe(false);
  });
  it.each(['ko', 'en'] as const)('%s MCP 안내는 설정 관례와 지원 필드를 설명한다', (lang) => {
    setLanguage(lang);
    expect(t('mcpServersSectionDesc')).toContain('Streamable HTTP');
    expect(t('mcpServersSectionDesc')).toContain('SSE');
    expect(t('mcpServersSectionDesc')).toContain('mcpServers');
    expect(t('mcpServersSectionDesc')).toContain('stdio');
    for (const field of [
      'Claude Desktop',
      'command',
      'url',
      'transport',
      'http',
      'sse',
      'authTokenSecret',
    ]) {
      expect(t('settingsMcpJsonFormatHelp')).toContain(field);
    }
    for (const field of ['mcpServers', 'command', 'args', 'env'])
      expect(t('settingsMcpJsonFormatHelp')).toContain(field);
  });
});

describe('숫자 표시 계약', () => {
  it.each(['ko', 'en'] as const)('%s에서 모든 숫자 변수에 천 단위 쉼표를 넣는다', (lang) => {
    setLanguage(lang);
    expect(
      t('ragIndexingPhaseWithChunks', { phase: 'phase', completed: 12345, total: 9876543 }),
    ).toContain('12,345/9,876,543');
    expect(t('providerImportContext', { v0: -12345.6789 })).toContain('-12,345.6789');
    expect(t('providerImportContext', { v0: 0 })).toContain('0');
  });
  it('숫자처럼 보이는 식별 문자열은 보존한다', () => {
    expect(t('providerImportContext', { v0: '123456' })).toContain('123456');
    expect(t('providerImportContext', { v0: 'model-123456' })).toContain('model-123456');
  });
});
