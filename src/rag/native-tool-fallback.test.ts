import { describe, expect, it } from 'vitest';

import { planNativeToolCompatibilityFallbackRust } from './rust-core';

describe('planNativeToolCompatibilityFallbackRust', () => {
  it('명확한 native tools 미지원 오류를 compatibility 재시도로 전환한다', () => {
    expect(
      planNativeToolCompatibilityFallbackRust({
        status: 400,
        message: 'This model does not support tools',
        nativeAttempted: true,
        compatibilityFallbackAttempted: false,
      }),
    ).toEqual({ retryWithCompatibility: true });
  });

  it('인증과 일반 요청 오류는 compatibility 재시도로 전환하지 않는다', () => {
    expect([
      planNativeToolCompatibilityFallbackRust({
        status: 401,
        message: 'Unauthorized while requesting tools',
        nativeAttempted: true,
        compatibilityFallbackAttempted: false,
      }),
      planNativeToolCompatibilityFallbackRust({
        status: 400,
        message: 'Invalid tools schema',
        nativeAttempted: true,
        compatibilityFallbackAttempted: false,
      }),
    ]).toEqual([{ retryWithCompatibility: false }, { retryWithCompatibility: false }]);
  });

  it('compatibility fallback을 이미 시도한 턴은 다시 재시도하지 않는다', () => {
    expect(
      planNativeToolCompatibilityFallbackRust({
        status: 422,
        message: 'Extra inputs are not permitted: tool_choice',
        nativeAttempted: true,
        compatibilityFallbackAttempted: true,
      }),
    ).toEqual({ retryWithCompatibility: false });
  });
});
