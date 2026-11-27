import { describe, expect, it, vi } from 'vitest';
import { prepareLiteralReview } from './literal-review';
import type { IndexedVaultReviewOptions } from './indexed-vault-review';
import type { LiteralInventoryHandle, LiteralInventorySummary } from '../rag/literal-inventory';

function fixture() {
  const summary: LiteralInventorySummary = { matchMode: 'nfkc-unicode-lower-line-substring-v1', generationId: 'synthetic', receipt: { version: 1, incarnation: crypto.randomUUID(), mutation: crypto.randomUUID() }, sources: 1, needles: [{ needle: 'needle', normalizedNeedle: 'needle', documents: 0, matchingLines: 0, occurrences: 0 }], pageCount: 0 };
  const close = vi.fn(() => Promise.resolve());
  const handle: LiteralInventoryHandle = { getSummary: () => Promise.resolve(summary), readPage: () => Promise.resolve(null), close };
  const open = vi.fn(() => Promise.resolve(handle));
  const options: IndexedVaultReviewOptions = { question: 'needle', indexedPaths: ['synthetic/source.txt'], scopes: [], openLiteralInventory: open, provider: { streamChat: vi.fn() } };
  return { options, handle, open, close, summary };
}

describe('literal 조사 원장과 기존 evidence 경계', () => {
  it('직접 입력은 trim이나 planner 절단으로 잃지 않고 요청 범위를 전달한다', async () => {
    const { options, open } = fixture(); options.literalQuery = ' Needle  ';
    options.discoveryPaths = ['synthetic/source.txt', 'synthetic/other.txt'];
    const prepared = await prepareLiteralReview(options);
    expect(open).toHaveBeenCalledWith([' Needle  '], undefined, options.discoveryPaths);
    expect(prepared.options.literalInventory?.status).toBe('complete');
    expect(prepared.options.indexedPaths).toEqual(options.indexedPaths);
    await prepared.handle?.close();
  });
  it('현재 미지원 filter를 모델 전달 이전 옵션에도 명시한다', async () => {
    const { options, open } = fixture(); options.filters = {};
    const result = await prepareLiteralReview(options);
    expect(result.inventory).toEqual({ status: 'unavailable', reason: 'unsupported-filters' });
    expect(result.options.literalInventory).toEqual(result.inventory);
    expect(open).not.toHaveBeenCalled();
  });
  it('literal 실패는 raw 이유나 token 수로 바꾸지 않고 모델 전달 전 보존한다', async () => {
    const { options, open } = fixture(); open.mockRejectedValue(new Error('synthetic-private-error'));
    const result = await prepareLiteralReview(options);
    expect(result.inventory).toEqual({ status: 'failed', reason: 'source-literal-unavailable' });
    expect(result.options.literalInventory).toEqual(result.inventory);
    expect(JSON.stringify(result.inventory)).not.toContain('synthetic-private-error');
  });
  it.each([false, true])('opener 부재도 filter=%s 상태를 옵션·원장에 명시한다', async (filters) => {
    const { options } = fixture(); delete options.openLiteralInventory;
    if (filters) options.filters = {};
    const result = await prepareLiteralReview(options);
    expect(result.inventory).toEqual({ status: 'unavailable', reason: filters ? 'unsupported-filters' : 'source-literal-unavailable' });
    expect(result.options.literalInventory).toEqual(result.inventory);
  });
  it('기존 후보 110개가 실제 읽은 새 literal 대표 슬롯을 소비하지 않는다', async () => {
    const { options, handle, summary } = fixture();
    const previous = Array.from({ length: 110 }, (_, index) => `synthetic/old-${index}.txt`);
    const target = 'synthetic/new-literal.txt';
    options.indexedPaths = previous.slice(0, 96); options.discoveryPaths = [...previous, target];
    options.candidates = previous.map((path, index) => ({ path, source: 'bm25', score: 1, rank: index + 1 }));
    options.discoveryCandidates = options.candidates;
    summary.pageCount = 1;
    handle.readPage = (index) => Promise.resolve(index === 0 ? { pageIndex: 0, nextPage: null, references: [{ path: target, contentHash: '11111111', sourceMetadataHash: 'aaaaaaaa', sourceMtime: 1, sourceSize: 6, needleIndex: 0, line: 1, byteStart: 0, byteEnd: 6, utf16Start: 0, utf16End: 6, normalizedStart: 0, normalizedEnd: 6, sourceSegments: [] }] } : null);
    const result = await prepareLiteralReview(options);
    expect(previous.slice(0, 96).every((path) => result.options.indexedPaths.includes(path))).toBe(true);
    expect(result.options.indexedPaths).toContain(target);
    await result.handle?.close();
  });
  it('준비 도중 취소하면 성공 원장 없이 자기 handle을 닫는다', async () => {
    const { options, handle, close } = fixture();
    const controller = new AbortController(); options.signal = controller.signal;
    handle.getSummary = () => { controller.abort(); return Promise.reject(new DOMException('synthetic-cancel', 'AbortError')); };
    await expect(prepareLiteralReview(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
  });
});

it('준비된 세대가 없으면 literal 성공으로 indexing을 덮어쓰지 않는다', async () => {
  const { options, open } = fixture();
  options.candidatesState = 'indexing';
  const result = await prepareLiteralReview(options);
  expect(open).not.toHaveBeenCalled();
  expect(result.options.candidatesState).toBe('indexing');
});
