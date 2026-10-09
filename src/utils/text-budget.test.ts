import { describe, expect, it } from 'vitest';
import { truncateUtf8Text } from './text-budget';

const encoder = new TextEncoder();

describe('UTF-8 텍스트 예산', () => {
  it('예산 안의 텍스트는 그대로 둔다', () => {
    expect(truncateUtf8Text('hello', 5)).toEqual({ text: 'hello', truncated: false });
  });

  it('ASCII와 다중 바이트 문자를 모두 실제 UTF-8 바이트 상한 안으로 자른다', () => {
    for (const value of ['x'.repeat(10_000), '한글🙂'.repeat(4_000)]) {
      const result = truncateUtf8Text(value, 1_024);

      expect(result.truncated).toBe(true);
      expect(result.text).toContain('output truncated');
      expect(encoder.encode(result.text).byteLength).toBeLessThanOrEqual(1_024);
    }
  });
});
