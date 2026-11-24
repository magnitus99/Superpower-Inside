import { describe, expect, it, vi } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { readSourceFileSnapshot } from './source-snapshot';
import * as rustCore from './rust-core';
import { buildSourceDocuments } from './source-document';

const CONTENT = '스냅샷 근거';

/**
 * Obsidian `TFile`처럼 인스턴스 메서드 `cache()`를 프로토타입에 둔 최소 대역입니다.
 * 바이트 읽기 대역도 이 메서드를 호출해 스프레드 사본의 인스턴스 계약 손실을 재현합니다.
 */
class ObsidianLikeFile {
  readonly stat: { mtime: number; size: number };

  constructor(
    readonly path: string,
    readonly name: string,
    readonly basename: string,
    readonly extension: string,
    readonly content: string,
    mtime: number,
  ) {
    this.stat = { mtime, size: content.length };
  }

  cache(_content: string | null): void {}
}

class ObsidianLikeVault {
  constructor(private readonly file: ObsidianLikeFile) {}

  readBinary(file: TFile): Promise<ArrayBuffer> {
    // 원문 API가 파일 인스턴스 메서드를 사용해도 스냅샷이 이를 보존합니다.
    (file as unknown as ObsidianLikeFile).cache(this.file.content);
    return Promise.resolve(new TextEncoder().encode(this.file.content).buffer);
  }

  getAbstractFileByPath(path: string): TFile | null {
    return path === this.file.path ? (this.file as unknown as TFile) : null;
  }
}

describe('readSourceFileSnapshot', () => {
  it('snapshot와 문서는 worker의 hash·chunks를 재사용하고 메인 계산을 호출하지 않는다', async () => {
    const file = new ObsidianLikeFile('prepared.md', 'prepared.md', 'prepared', 'md', CONTENT, 1);
    const vault = new ObsidianLikeVault(file);
    const hash = vi.spyOn(rustCore, 'createContentHashRust').mockImplementation(() => { throw new Error('main hash forbidden'); });
    const chunks = vi.spyOn(rustCore, 'planSourceChunksRust').mockImplementation(() => { throw new Error('main chunks forbidden'); });
    try {
      const snapshot = await readSourceFileSnapshot(vault as unknown as Vault, file as unknown as TFile, { preparation: { path: file.path, chunkSize: 1000, overlap: 20 } });
      expect(snapshot?.chunks).toHaveLength(1);
      const docs = buildSourceDocuments(file as unknown as TFile, CONTENT, { chunkSize: 1000, overlap: 20 }, [], undefined, snapshot?.chunks, snapshot?.revision.contentHash);
      expect(docs[0].text).toBe(CONTENT);
      expect(hash).not.toHaveBeenCalled();
      expect(chunks).not.toHaveBeenCalled();
    } finally { hash.mockRestore(); chunks.mockRestore(); }
  });
  it('worker의 bodyPlan을 본문과 같은 snapshot으로 전달한다', async () => {
    const file = new ObsidianLikeFile('body-plan.md', 'body-plan.md', 'body-plan', 'md', CONTENT, 1);
    const vault = new ObsidianLikeVault(file);
    const byteLength = new TextEncoder().encode(CONTENT).length;
    const bodyPlan = { version: 1 as const, byteLength, utf16Length: CONTENT.length, scanChargeBytes: 4096, blocks: [{ startByte: 0, endByte: byteLength, startUtf16: 0, endUtf16: CONTENT.length }] };
    const original = rustCore.prepareSourceBytesRust;
    const prepare = vi.spyOn(rustCore, 'prepareSourceBytesRust').mockImplementation((...args) => {
      const result = original(...args);
      return result?.prepared ? { ...result, prepared: { ...result.prepared, bodyPlan } } : result;
    });
    try {
      const snapshot = await readSourceFileSnapshot(vault as unknown as Vault, file as unknown as TFile);
      expect(snapshot?.bodyPlan).toEqual(bodyPlan);
      expect(snapshot?.content).toBe(CONTENT);
    } finally { prepare.mockRestore(); }
  });

  it('forceRefresh 원문 검증은 오래된 cachedRead를 사용하지 않고 읽는 중 revision 변경도 거부한다', async () => {
    const file = new ObsidianLikeFile(
      'notes/current.md',
      'current.md',
      'current',
      'md',
      CONTENT,
      1,
    );
    const base = new ObsidianLikeVault(file);
    const vault = Object.assign(base, {
      cachedRead: vi.fn(() => Promise.resolve('stale cached body')),
    });
    const snapshot = await readSourceFileSnapshot(
      vault as unknown as Vault,
      file as unknown as TFile,
      { forceRefresh: true },
    );
    expect(snapshot?.content).toBe(CONTENT);
    expect(vault.cachedRead).not.toHaveBeenCalled();
    vi.spyOn(vault, 'readBinary').mockImplementationOnce(() => {
      file.stat.mtime++;
      return Promise.resolve(new TextEncoder().encode(CONTENT).buffer);
    });
    expect(
      await readSourceFileSnapshot(vault as unknown as Vault, file as unknown as TFile, {
        forceRefresh: true,
      }),
    ).toBeNull();
  });

  it.each(['initial', 'reread'] as const)(
    '%s 스냅샷을 같은 signal로 읽는 도중 취소하면 즉시 종료하고 늦은 본문은 반영하지 않는다',
    async (phase) => {
      const file = new ObsidianLikeFile('notes/cancel.md', 'cancel.md', 'cancel', 'md', CONTENT, 1);
      const vault = new ObsidianLikeVault(file);
      const controller = new AbortController();
      const options = { signal: controller.signal };
      if (phase === 'reread') {
        expect(
          (
            await readSourceFileSnapshot(
              vault as unknown as Vault,
              file as unknown as TFile,
              options,
            )
          )?.content,
        ).toBe(CONTENT);
      }
      let resolveRead!: (bytes: ArrayBuffer) => void;
      vi.spyOn(vault, 'readBinary').mockReturnValueOnce(
        new Promise<ArrayBuffer>((resolve) => {
          resolveRead = resolve;
        }),
      );
      const lookup = vi.spyOn(vault, 'getAbstractFileByPath');
      let outcome: unknown;
      const reading = readSourceFileSnapshot(
        vault as unknown as Vault,
        file as unknown as TFile,
        options,
      );
      const observed = reading.catch((error: unknown) => {
        outcome = error;
      });
      try {
        controller.abort();
        await vi.waitFor(() => expect(outcome).toMatchObject({ name: 'AbortError' }));
        expect(lookup).not.toHaveBeenCalled();
      } finally {
        resolveRead(new TextEncoder().encode('late content').buffer);
        await observed;
      }
      await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it('프로토타입 메서드를 유지한 파일로 현재 바이트를 읽는다', async () => {
    const file = new ObsidianLikeFile('notes/source.md', 'source.md', 'source', 'md', CONTENT, 1);
    const vault = new ObsidianLikeVault(file);

    const snapshot = await readSourceFileSnapshot(
      vault as unknown as Vault,
      file as unknown as TFile,
    );

    expect(snapshot?.content).toBe(CONTENT);
    expect(snapshot?.file.stat).toEqual({ mtime: 1, size: CONTENT.length });
  });
});
