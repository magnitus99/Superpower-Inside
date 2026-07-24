import { afterEach, describe, expect, it } from 'vitest';
import {
  getLanguage,
  isLocalizedValue,
  resolveUiLanguage,
  setLanguage,
  t,
} from './i18n';

afterEach(() => {
  setLanguage('en');
});

describe('UI 언어 계약', () => {
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
    expect(t('tabProviders')).toBe('Providers');
    expect(t('providerNewName')).toBe('New provider');
    expect(/[가-힣]/u.test(`${t('tabProviders')} ${t('providerNewName')}`)).toBe(false);
  });

  it('RAG 안내는 공통 파일 범위와 GraphRAG의 .md 예외를 함께 밝힌다', () => {
    setLanguage('en');

    expect(t('ragFoundationDescription')).toContain('embeddings, BM25');
    expect(t('ragFoundationDescription')).toContain('built-in vault tools');
    expect(t('ragGraphSectionDescription')).toContain('.md notes');
  });

  it('양쪽 언어의 자동 생성 기본값을 식별한다', () => {
    expect(isLocalizedValue('providerNewName', '새 프로바이더')).toBe(true);
    expect(isLocalizedValue('providerNewName', 'New provider')).toBe(true);
    expect(isLocalizedValue('providerNewName', 'Research endpoint')).toBe(false);
  });
});
