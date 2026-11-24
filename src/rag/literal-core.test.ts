import { describe, expect, it, vi } from 'vitest';
import * as rustCore from './rust-core';
import { RustLiteralSourceScanner, RustLiteralInventoryTotals, LiteralCoreError, type LiteralScannerInput, type LiteralSourceSummary } from './literal-core';

function input(text: string, needles: string[], path = 'synthetic/source.txt'): LiteralScannerInput {
  const plan = rustCore.planSourceBodyRust(text);
  if (!plan) throw new Error('literal-test-plan-missing');
  return { version: 1, needles, maxChargeBytes: 32 * 1024 * 1024, source: { path, contentHash: rustCore.createContentHashRust(text) ?? '', sourceMetadataHash: 'aaaaaaaa', sourceMtime: 10.25, sourceSize: new TextEncoder().encode(text).length, version: 1, byteLength: plan.byteLength, utf16Length: plan.utf16Length, blockCount: plan.blocks.length, scanChargeBytes: plan.scanChargeBytes, segments: [{ startLine: 0, endLine: 0 }] } };
}
function fill(scanner: RustLiteralSourceScanner, text: string): void {
  const plan = rustCore.planSourceBodyRust(text);
  if (!plan) throw new Error('literal-test-plan-missing');
  for (const [index, block] of plan.blocks.entries()) scanner.appendBlock({ index, ...block, text: text.slice(block.startUtf16, block.endUtf16) });
  scanner.seal();
}
function complete(text: string, needles: string[], path?: string): LiteralSourceSummary {
  const scanner = new RustLiteralSourceScanner(input(text, needles, path));
  try { fill(scanner, text); while (!scanner.nextPage(1, 4096).done) { /* 전체 원장을 배출합니다. */ } return scanner.summary(); }
  finally { scanner.close(); }
}

describe('실제 WASM 원문 literal wire', () => {
  it('준비한 bodyPlan과 직접 계획이 같은 WASM runtime의 계약이다', () => {
    const text = 'raw\r\nﬃ Ａ';
    const prepared = rustCore.prepareSourceBytesRust('txt', new TextEncoder().encode(text), { path: 'synthetic.txt' });
    expect(prepared?.prepared?.bodyPlan).toEqual(rustCore.planSourceBodyRust(text));
  });
  it('조사·긴 영문 내부·NFKC·CR과 확장 발생을 token 없이 센다', () => {
    const text = '항구시험의 항구시험은 항구시험을 항구시험이\nＣＯＮＤＩＴＩＯＮ ﬃ\r\nomegaGammadelta';
    const scanner = new RustLiteralSourceScanner(input(text, ['항구시험', 'condition', 'f', '\r', 'gammad']));
    try {
      fill(scanner, text);
      const references = [];
      let page;
      do { page = scanner.nextPage(1, 4096); references.push(...page.references); } while (!page.done);
      expect(scanner.summary().needles.map(({ documents, matchingLines, occurrences }) => ({ documents, matchingLines, occurrences }))).toEqual([
        { documents: 1, matchingLines: 1, occurrences: 4 }, { documents: 1, matchingLines: 1, occurrences: 1 }, { documents: 1, matchingLines: 1, occurrences: 2 }, { documents: 1, matchingLines: 1, occurrences: 1 }, { documents: 1, matchingLines: 1, occurrences: 1 },
      ]);
      const expanded = references.filter((reference) => reference.needleIndex === 2);
      expect(expanded).toHaveLength(2);
      expect(expanded[0].utf16Start).toBe(expanded[1].utf16Start);
      expect(expanded[0].normalizedStart).not.toBe(expanded[1].normalizedStart);
      expect(references.filter((reference) => reference.needleIndex === 0).every((reference) => reference.line === 1 && reference.sourceSegments[0] === 0)).toBe(true);
    } finally { scanner.close(); }
  });
  it('빈 원문 capability만 명시적 완전 0이 된다', () => {
    expect(complete('', ['needle']).needles[0]).toMatchObject({ documents: 0, matchingLines: 0, occurrences: 0 });
  });
  it('같은 본문 구간에서 aa는 비중첩이고 공백을 바꾸지 않는다', () => {
    const summary = complete('aaaaa\na  b\na b', ['aa', 'a  b', 'a b', 'a\nb']);
    expect(summary.needles.map((needle) => needle.occurrences)).toEqual([2, 1, 1, 0]);
  });
  it('잘못된 hash나 미완료 입력은 성공 0으로 바꾸지 않는다', () => {
    const value = input('needle', ['needle']);
    const scanner = new RustLiteralSourceScanner({ ...value, source: { ...value.source, contentHash: '00000000' } });
    try { expect(() => fill(scanner, 'needle')).toThrow(LiteralCoreError); }
    finally { scanner.close(); }
    const missing = new RustLiteralSourceScanner(value);
    try { expect(() => missing.seal()).toThrow('incomplete-input'); }
    finally { missing.close(); }
  });
  it('부분 배출·닫힌 owner는 summary를 인증하지 않는다', () => {
    const scanner = new RustLiteralSourceScanner(input('x x x', ['x']));
    fill(scanner, 'x x x');
    expect(() => scanner.summary()).toThrow('not-ready');
    scanner.close(); scanner.close();
    expect(() => scanner.nextPage(1, 4096)).toThrow('closed');
  });
  it('전체 합산은 실제 source 수와 순서 및 needle identity를 확인한다', () => {
    const totals = new RustLiteralInventoryTotals({ version: 1, needles: ['aa'], expectedSources: 2 });
    try {
      totals.appendSource(complete('aaaaa', ['aa'], 'synthetic/a'));
      expect(() => totals.finish()).toThrow('incomplete-sources');
      totals.appendSource(complete('aa\naa', ['aa'], 'synthetic/b'));
      expect(totals.finish()).toMatchObject({ sources: 2, needles: [{ needle: 'aa', documents: 2, matchingLines: 3, occurrences: 4 }] });
    } finally { totals.close(); }
  });
  it('중복 source를 다시 합산하지 않는다', () => {
    const totals = new RustLiteralInventoryTotals({ version: 1, needles: ['x'], expectedSources: 2 });
    try {
      const summary = complete('x', ['x']); totals.appendSource(summary);
      expect(() => totals.appendSource(summary)).toThrow('source-order');
      expect(() => totals.finish()).toThrow('source-order');
    } finally { totals.close(); }
  });
  it('분수 페이지 상한을 WASM u32 변환으로 조용히 반올림하지 않는다', () => {
    const value = input('x x x', ['x']); value.source.segments = [];
    const scanner = new RustLiteralSourceScanner(value);
    try { fill(scanner, 'x x x'); expect(() => scanner.nextPage(1.5, 4096)).toThrow('invalid-page'); }
    finally { scanner.close(); }
  });
  it.each(['append', 'seal'] as const)('false %s ACK를 성공 summary로 덮지 않는다', (operation) => {
    const value = input('', ['needle']);
    const summary = JSON.stringify({ ...value.source, ok: true, version: 1, needles: [{ needle: 'needle', normalizedNeedle: 'needle', documents: 0, matchingLines: 0, occurrences: 0 }] });
    const sourceSummary = vi.fn().mockReturnValueOnce('{"ok":false,"reason":"not-ready"}').mockReturnValue(summary);
    const create = vi.spyOn(rustCore, 'createLiteralSourceScannerRust').mockReturnValue({ append_block_json: () => false, seal_input: () => false, summary_json: sourceSummary, next_page_json: () => '{}', free: () => {} });
    try {
      const scanner = new RustLiteralSourceScanner(value);
      try { expect(() => operation === 'seal' ? scanner.seal() : scanner.appendBlock({ index: 0, startByte: 0, endByte: 0, startUtf16: 0, endUtf16: 0, text: '' })).toThrow('invalid-response'); }
      finally { scanner.close(); }
    } finally { create.mockRestore(); }
  });
  it('잘못된 native page를 원문 없는 고정 오류로 닫는다', () => {
    const free = vi.fn();
    const create = vi.spyOn(rustCore, 'createLiteralSourceScannerRust').mockReturnValue({ append_block_json: () => true, seal_input: () => true, summary_json: () => '{"ok":false,"reason":"not-ready"}', next_page_json: () => '{"ok":true,"done":true,"references":[null]}', free });
    try {
      const scanner = new RustLiteralSourceScanner(input('', ['needle']));
      expect(() => scanner.nextPage(1, 4096)).toThrow('invalid-response');
      scanner.close(); expect(free).toHaveBeenCalledOnce();
    } finally { create.mockRestore(); }
  });
});
