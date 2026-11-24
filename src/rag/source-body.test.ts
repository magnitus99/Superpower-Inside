import { describe, expect, it } from 'vitest';
import { isRustSourceReadResult, prepareSourceBytesRust } from './rust-core';

const text = '😀ab';
const source = prepareSourceBytesRust('txt', new TextEncoder().encode(text), { path: 'synthetic/body.txt' });
if (!source?.prepared) throw new Error('Synthetic source preparation unavailable.');
const plan = {
  version: 1, byteLength: 6, utf16Length: 4, scanChargeBytes: 4096,
  blocks: [{ startByte: 0, endByte: 6, startUtf16: 0, endUtf16: 4 }],
};
const withPlan = (bodyPlan: unknown) => ({ ...source, prepared: { ...source.prepared, bodyPlan } });

describe('준비 원문의 block wire 경계', () => {
  it('정상 원문 범위와 bodyPlan 없는 legacy 준비를 구분해 읽는다', () => {
    expect(isRustSourceReadResult(withPlan(plan))).toBe(true);
    const legacy = { ...source, prepared: { ...source.prepared } };
    delete legacy.prepared.bodyPlan;
    expect(isRustSourceReadResult(legacy)).toBe(true);
  });

  it.each([
    null,
    { ...plan, version: 2 },
    { ...plan, byteLength: 0 },
    { ...plan, utf16Length: 3 },
    { ...plan, scanChargeBytes: -1 },
    { ...plan, scanChargeBytes: Number.NaN },
    { ...plan, blocks: Array(1) },
    { ...plan, blocks: [{ ...plan.blocks[0], startByte: 1 }] },
    { ...plan, blocks: [{ ...plan.blocks[0], endByte: 7 }] },
    { ...plan, blocks: [{ ...plan.blocks[0], endUtf16: 4.5 }] },
    { ...plan, blocks: [{ startByte: 0, endByte: 3, startUtf16: 0, endUtf16: 1 }, { startByte: 3, endByte: 6, startUtf16: 1, endUtf16: 4 }] },
  ])('손상·희소·불연속·surrogate 분할 plan을 원문 준비 성공으로 승격하지 않는다', (invalid) => {
    expect(isRustSourceReadResult(withPlan(invalid))).toBe(false);
  });
});
