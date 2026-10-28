import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CASES,
  chromeCandidates,
  findChrome,
  parsePreviewResult,
} from './preview-verify.mjs';

describe('헤드리스 Chrome 검수', () => {
  it('고정 뷰포트·테마·빈/오류 상태를 포함한다', () => {
    expect(PREVIEW_CASES.map((scenario) => scenario.name)).toEqual([
      'chat-light-narrow',
      'chat-dark-medium',
      'chat-empty-light',
      'chat-error-dark',
      'search-light-narrow',
      'search-dark-medium',
      'search-empty-dark',
    ]);
    expect(PREVIEW_CASES.every((scenario) => scenario.query.includes('check'))).toBe(true);
    expect(PREVIEW_CASES.some((scenario) => scenario.width <= 360)).toBe(true);
  });

  it('플랫폼별 Chrome 후보와 실행 파일 선택을 분리한다', () => {
    expect(
      chromeCandidates({
        platform: 'darwin',
        environment: { CHROME_PATH: '/custom/chrome' },
      }),
    ).toEqual([
      '/custom/chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]);
    const candidates = ['/missing/chrome', 'google-chrome'];
    expect(
      findChrome(candidates, {
        exists: (path) => path === '/missing/chrome',
        which: () => false,
      }),
    ).toBe('/missing/chrome');
    expect(
      findChrome(candidates, { exists: () => false, which: (command) => command === 'google-chrome' }),
    ).toBe('google-chrome');
    expect(findChrome(candidates, { exists: () => false, which: () => false })).toBeNull();
  });

  it('DOM의 검수 상태와 텍스트를 읽고 실패·누락을 성공으로 처리하지 않는다', () => {
    expect(
      parsePreviewResult(
        '<div id="preview-result" data-failed="false">기본 스타일·호스트 8개 통과</div>',
      ),
    ).toEqual({ failed: false, text: '기본 스타일·호스트 8개 통과' });
    expect(
      parsePreviewResult('<div data-failed="true" id="preview-result">검수 실패</div>').failed,
    ).toBe(true);
    expect(parsePreviewResult('<div id="preview-result">실행 중</div>').failed).toBe(true);
    expect(parsePreviewResult('<div>결과 없음</div>').failed).toBe(true);
  });
});
