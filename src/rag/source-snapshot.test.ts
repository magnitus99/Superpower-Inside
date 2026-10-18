import { describe, expect, it, vi } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { readSourceFileSnapshot } from './source-snapshot';

const CONTENT = '스냅샷 근거';

/**
 * Obsidian `TFile`처럼 인스턴스 메서드 `cache()`를 프로토타입에 둔 최소 대역입니다.
 * `vault.cachedRead`가 이 메서드를 호출하므로, 스프레드 사본을 넘기면 재현됩니다.
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

  cachedRead(file: TFile): Promise<string> {
    // Obsidian `Vault.read`는 전달받은 파일 객체의 `cache()`를 직접 호출합니다.
    (file as unknown as ObsidianLikeFile).cache(this.file.content);
    return Promise.resolve(this.file.content);
  }

  getAbstractFileByPath(path: string): TFile | null {
    return path === this.file.path ? (this.file as unknown as TFile) : null;
  }
}

describe('readSourceFileSnapshot', () => {
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
      let resolveRead!: (text: string) => void;
      vi.spyOn(vault, 'cachedRead').mockReturnValueOnce(
        new Promise<string>((resolve) => {
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
        resolveRead('late content');
        await observed;
      }
      await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it('프로토타입 메서드를 유지한 파일로 읽어 cachedRead가 실패하지 않는다', async () => {
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
