import { createLiteralSourceScannerRust, createLiteralInventoryTotalsRust, type LiteralSourceScannerCore, type LiteralInventoryTotalsCore } from './rust-core';
import type { RustSourceBodyBlockRange } from './source-body';

export interface LiteralSourceHeader {
  path: string;
  contentHash: string;
  sourceMetadataHash: string;
  sourceMtime: number;
  sourceSize: number;
  version: 1;
  byteLength: number;
  utf16Length: number;
  blockCount: number;
  scanChargeBytes: number;
  segments: { startLine: number; endLine: number }[];
}
export interface LiteralScannerInput { version: 1; needles: readonly string[]; source: LiteralSourceHeader; maxChargeBytes: number }
export interface LiteralSourceBlock extends RustSourceBodyBlockRange { index: number; text: string }
export interface LiteralReference {
  path: string; contentHash: string; sourceMetadataHash: string; sourceMtime: number; sourceSize: number;
  needleIndex: number; line: number; byteStart: number; byteEnd: number; utf16Start: number; utf16End: number;
  normalizedStart: number; normalizedEnd: number; sourceSegments: number[];
}
export interface LiteralPage { ok: true; done: boolean; references: LiteralReference[] }
export interface LiteralNeedleCounts { needle: string; normalizedNeedle: string; documents: number; matchingLines: number; occurrences: number }
export interface LiteralSourceSummary { ok: true; version: 1; path: string; contentHash: string; sourceMetadataHash: string; sourceMtime: number; sourceSize: number; needles: LiteralNeedleCounts[] }
export interface LiteralTotals { ok: true; version: 1; sources: number; needles: LiteralNeedleCounts[] }
export interface LiteralTotalsInput { version: 1; needles: readonly string[]; expectedSources: number }
const REASONS = new Set(['invalid-input', 'invalid-block', 'incomplete-input', 'source-hash', 'memory-budget', 'not-ready', 'not-sealed', 'invalid-page', 'output-budget', 'projection-failed', 'count-overflow', 'invalid-summary', 'source-order', 'needle-identity', 'invalid-counts', 'incomplete-sources']);
export class LiteralCoreError extends Error {
  constructor(readonly reason: string) { super(`rag-literal-${reason}`); this.name = 'LiteralCoreError'; }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function size(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function parse(json: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new LiteralCoreError('invalid-response'); }
  if (!record(value)) throw new LiteralCoreError('invalid-response');
  if (value.ok !== true) throw new LiteralCoreError(typeof value.reason === 'string' && REASONS.has(value.reason) ? value.reason : 'invalid-response');
  return value;
}
function counts(value: unknown, needles: readonly string[]): value is LiteralNeedleCounts[] {
  return Array.isArray(value) && value.length === needles.length && Array.from(value as unknown[]).every((item, index) => record(item) && item.needle === needles[index] && typeof item.normalizedNeedle === 'string' && item.normalizedNeedle.length > 0 && size(item.documents) && size(item.matchingLines) && size(item.occurrences));
}
function identity(value: Record<string, unknown>, source: LiteralSourceHeader): boolean {
  return value.path === source.path && value.contentHash === source.contentHash && value.sourceMetadataHash === source.sourceMetadataHash && value.sourceMtime === source.sourceMtime && value.sourceSize === source.sourceSize;
}
export function parseLiteralPage(json: string, input: LiteralScannerInput, maxMatches: number, segmentCount = input.source.segments.length): LiteralPage {
  const value = parse(json);
  if (typeof value.done !== 'boolean' || !Array.isArray(value.references) || (!value.done && value.references.length === 0) || value.references.length > maxMatches || !Array.from(value.references as unknown[]).every((item) => {
    if (!record(item) || !identity(item, input.source) || !size(item.needleIndex) || item.needleIndex >= input.needles.length || !size(item.line) || item.line === 0 || !size(item.byteStart) || !size(item.byteEnd) || item.byteEnd <= item.byteStart || item.byteEnd > input.source.byteLength || !size(item.utf16Start) || !size(item.utf16End) || item.utf16End <= item.utf16Start || item.utf16End > input.source.utf16Length || !size(item.normalizedStart) || !size(item.normalizedEnd) || item.normalizedEnd <= item.normalizedStart || !Array.isArray(item.sourceSegments)) return false;
    return Array.from(item.sourceSegments as unknown[]).every((index) => size(index) && index < segmentCount);
  })) throw new LiteralCoreError('invalid-response');
  return value as unknown as LiteralPage;
}
export function parseLiteralSummary(json: string, input: LiteralScannerInput): LiteralSourceSummary {
  const value = parse(json);
  if (value.version !== 1 || !identity(value, input.source) || !counts(value.needles, input.needles) || value.needles.some((count) => count.documents > 1)) throw new LiteralCoreError('invalid-response');
  return value as unknown as LiteralSourceSummary;
}
export function parseLiteralTotals(json: string, input: LiteralTotalsInput): LiteralTotals {
  const value = parse(json);
  if (value.version !== 1 || value.sources !== input.expectedSources || !counts(value.needles, input.needles)) throw new LiteralCoreError('invalid-response');
  return value as unknown as LiteralTotals;
}

export class RustLiteralSourceScanner {
  private core: LiteralSourceScannerCore | null;
  private readonly input: LiteralScannerInput;
  private readonly segmentCount: number;
  constructor(input: LiteralScannerInput) {
    this.input = { ...input, needles: [...input.needles], source: { ...input.source } };
    this.segmentCount = input.source.segments.length;
    this.core = createLiteralSourceScannerRust(this.input);
    if (!this.core) throw new LiteralCoreError('core-unavailable');
    try { parse(this.core.summary_json()); throw new LiteralCoreError('invalid-response'); }
    catch (error) { if (!(error instanceof LiteralCoreError) || error.reason !== 'not-ready') { this.close(); throw error; } }
  }
  appendBlock(block: LiteralSourceBlock): void { const core = this.owner(); if (!core.append_block_json(JSON.stringify(block))) { parse(core.summary_json()); throw new LiteralCoreError('invalid-response'); } }
  seal(): void { const core = this.owner(); if (!core.seal_input()) { parse(core.summary_json()); throw new LiteralCoreError('invalid-response'); } }
  nextPage(maxMatches: number, maxBytes: number): LiteralPage {
    const core = this.owner();
    if (!Number.isSafeInteger(maxMatches) || maxMatches < 1 || maxMatches > 256 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) throw new LiteralCoreError('invalid-page');
    return parseLiteralPage(core.next_page_json(maxMatches, maxBytes), this.input, maxMatches, this.segmentCount);
  }
  summary(): LiteralSourceSummary { return parseLiteralSummary(this.owner().summary_json(), this.input); }
  close(): void { const core = this.core; this.core = null; core?.free(); }
  private owner(): LiteralSourceScannerCore { if (!this.core) throw new LiteralCoreError('closed'); return this.core; }
}
export class RustLiteralInventoryTotals {
  private core: LiteralInventoryTotalsCore | null;
  private readonly input: LiteralTotalsInput;
  constructor(input: LiteralTotalsInput) {
    this.input = { ...input, needles: [...input.needles] };
    this.core = createLiteralInventoryTotalsRust(this.input);
    if (!this.core) throw new LiteralCoreError('core-unavailable');
  }
  appendSource(summary: LiteralSourceSummary): void { const core = this.owner(); if (!core.append_source_json(JSON.stringify(summary))) { parse(core.finish_json()); throw new LiteralCoreError('invalid-response'); } }
  finish(): LiteralTotals { return parseLiteralTotals(this.owner().finish_json(), this.input); }
  close(): void { const core = this.core; this.core = null; core?.free(); }
  private owner(): LiteralInventoryTotalsCore { if (!this.core) throw new LiteralCoreError('closed'); return this.core; }
}
