import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CASES,
  chromeCandidates,
  findChrome,
  parsePreviewResult,
} from './preview-verify.mjs';

import { createIndexingPreviewSummary } from './obsidian-preview/progress.mjs';

describe('헤드리스 Chrome 검수', () => {
  it('실패 사유가 있는 화면과 미기록 화면을 별개로 검수한다', () => {
    expect(createIndexingPreviewSummary('failed')).toMatchObject({ activity: 'failed', lastInitError: expect.any(String), lastInitStage: 'opening-storage' });
    expect(createIndexingPreviewSummary('failed-missing')).toMatchObject({ activity: 'failed', lastInitError: null, lastInitStage: null });
  });
  it('고정 뷰포트·테마·빈/오류 상태를 포함한다', () => {
    expect(PREVIEW_CASES.map((scenario) => scenario.name)).toEqual([
      'quota-settings-light',
      'quota-settings-dark-narrow',
      'quota-settings-expanded',
      'quota-settings-empty',
      'quota-settings-disabled',
      'quota-chat-light',
      'quota-chat-error',
      'quota-chat-loading-en',
      'chat-light-narrow',
      'chat-dark-medium',
      'chat-empty-light',
      'chat-error-dark',
      'search-light-narrow',
      'search-dark-medium',
      'search-empty-dark',
      'progress-all-opening',
      'progress-all-legacy-restore',
      'progress-all-snapshot-bytes',
      'progress-all-model-init',
      'progress-all-verifying',
      'progress-all-publication-waiting',
      'progress-all-stalled',
      'progress-chat-serving',
      'progress-chat-unknown',
      'progress-chat-settling',
      'progress-chat-partial',
      'progress-chat-failed',
      'progress-chat-failed-collapsed',
      'progress-search-failed-dark',
      'progress-settings-failed',
      'progress-failed-missing-en',
      'restore-failed-settings',
      'restore-history-chat',
      'restore-history-settings-expanded',
      'restore-required-search-expanded',
      'restore-required-search',
      'restore-progress-saved',
      'progress-chat-user-paused',
      'progress-chat-performance-paused',
      'progress-search-serving',
      'progress-search-partial',
      'progress-chat-zoom',
      'progress-settings-serving',
      'progress-settings-dark-narrow',
      'progress-settings-settling',
      'progress-settings-user-paused',
      'manual-recovery-legacy',
      'manual-recovery-paused',
      'manual-recovery-initializing',
      'manual-recovery-invalid',
    ]);
    expect(PREVIEW_CASES.every((scenario) => scenario.query.includes('check'))).toBe(true);
    expect(PREVIEW_CASES.some((scenario) => scenario.width <= 360)).toBe(true);
  });

  it('현재 복원 오류·과거 이력·명시 업데이트·복원 진행을 분리한다', () => {
    expect(createIndexingPreviewSummary('restore-failed')).toMatchObject({ failure: { source: 'restore' }, updateRequired: true });
    expect(createIndexingPreviewSummary('restore-history')).toMatchObject({ failure: { source: 'saved', error: null } });
    expect(createIndexingPreviewSummary('restore-required')).toMatchObject({ updateRequired: true });
    expect(createIndexingPreviewSummary('restore-progress')).toMatchObject({ restoring: true, activity: 'preparing' });
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
      findChrome(candidates, {
        exists: () => false,
        which: (command) => command === 'google-chrome',
      }),
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
