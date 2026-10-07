import { describe, expect, it, vi } from 'vitest';
import {
  LocalEmbeddingModels,
  type LocalModelAsset,
  type LocalModelDownload,
} from './local-embedding-models';

vi.mock('obsidian', () => ({ requestUrl: vi.fn(), normalizePath: (path: string) => path }));

function fixture(download = vi.fn<LocalModelDownload>()) {
  const files = new Map<string, ArrayBuffer>();
  const adapter = {
    exists: (path: string) => Promise.resolve(files.has(path)),
    mkdir: () => Promise.resolve(),
    readBinary: (path: string) => Promise.resolve(files.get(path) ?? new ArrayBuffer(0)),
    writeBinary: (path: string, bytes: ArrayBuffer) => {
      files.set(path, bytes);
      return Promise.resolve();
    },
    remove: (path: string) => {
      files.delete(path);
      return Promise.resolve();
    },
    rename: (from: string, to: string) => {
      const bytes = files.get(from);
      if (!bytes) throw new Error('missing file');
      files.set(to, bytes);
      files.delete(from);
      return Promise.resolve();
    },
  };
  const asset: LocalModelAsset = {
    file: 'weights.bin',
    url: 'https://example.com/weights',
    size: 4,
    sha256: '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
  };
  const manager = new LocalEmbeddingModels(
    adapter,
    'plugins/test',
    {
      'embeddinggemma-300m': [asset],
      'ternlight-base': [{ ...asset, file: 'tern_engine_bg.wasm' }],
    },
    download,
    2,
  );
  return { files, manager, download };
}

describe('기본 임베딩 모델 파일 관리', () => {
  it('완료한 구간만 진행률에 반영하고 무결성 검증 뒤 저장한다', async () => {
    const f = fixture(
      vi.fn<LocalModelDownload>((_asset, start, end) =>
        Promise.resolve({
          status: 206,
          contentRange: `bytes ${start}-${end}/4`,
          bytes: new Uint8Array([1, 2, 3, 4].slice(start, end + 1)).buffer,
        }),
      ),
    );
    const progress: number[] = [];
    f.manager.subscribe('embeddinggemma-300m', (state) => progress.push(state.completedBytes));
    await f.manager.prepare('embeddinggemma-300m');
    expect(progress).toContain(2);
    expect(f.manager.state('embeddinggemma-300m').phase).toBe('ready');
    expect(
      Array.from(new Uint8Array(await f.manager.read('embeddinggemma-300m', 'weights.bin'))),
    ).toEqual([1, 2, 3, 4]);
    await f.manager.prepare('embeddinggemma-300m');
    expect(f.download).toHaveBeenCalledTimes(2);
  });

  it('취소 후 늦게 도착한 응답을 저장하지 않고 재시도할 수 있다', async () => {
    let finish: ((value: { status: number; bytes: ArrayBuffer }) => void) | undefined;
    const f = fixture(
      vi.fn<LocalModelDownload>(
        () =>
          new Promise<{ status: number; bytes: ArrayBuffer }>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const operation = f.manager.prepare('embeddinggemma-300m');
    await vi.waitFor(() => expect(f.download).toHaveBeenCalled());
    f.manager.cancel('embeddinggemma-300m');
    finish?.({ status: 200, bytes: new Uint8Array([1, 2, 3, 4]).buffer });
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.files.size).toBe(0);
    expect(f.manager.state('embeddinggemma-300m').phase).toBe('missing');
    f.download.mockImplementation((_asset, start, end) =>
      Promise.resolve({
        status: 206,
        contentRange: `bytes ${start}-${end}/4`,
        bytes: new Uint8Array([1, 2, 3, 4].slice(start, end + 1)).buffer,
      }),
    );
    await f.manager.prepare('embeddinggemma-300m');
    expect(f.manager.state('embeddinggemma-300m').phase).toBe('ready');
  });

  it('잘못된 파일은 준비 완료로 표시하지 않고 삭제는 해당 모델 파일에만 한정한다', async () => {
    const f = fixture(
      vi.fn<LocalModelDownload>(() =>
        Promise.resolve({ status: 200, bytes: new Uint8Array([9, 9, 9, 9]).buffer }),
      ),
    );
    await expect(f.manager.prepare('embeddinggemma-300m')).rejects.toThrow();
    expect(f.manager.state('embeddinggemma-300m').phase).toBe('error');
    f.files.set(
      'plugins/test/embeddinggemma-300m/weights.bin',
      new Uint8Array([1, 2, 3, 4]).buffer,
    );
    f.files.set('plugins/test/data.json', new ArrayBuffer(1));
    f.files.set('plugins/test/tern_engine_bg.wasm', new ArrayBuffer(1));
    await f.manager.remove('embeddinggemma-300m');
    expect(f.files.has('plugins/test/embeddinggemma-300m/weights.bin')).toBe(false);
    expect(f.files.has('plugins/test/data.json')).toBe(true);
    expect(f.files.has('plugins/test/tern_engine_bg.wasm')).toBe(true);
  });

  it('Ternlight 삭제도 Gemma와 설정을 보존하고 자동 재다운로드를 차단한다', async () => {
    const f = fixture();
    f.files.set('plugins/test/tern_engine_bg.wasm', new ArrayBuffer(1));
    f.files.set('plugins/test/embeddinggemma-300m/weights.bin', new ArrayBuffer(1));
    await f.manager.remove('ternlight-base');
    expect(f.files.has('plugins/test/tern_engine_bg.wasm')).toBe(false);
    expect(f.files.has('plugins/test/embeddinggemma-300m/weights.bin')).toBe(true);
    await expect(f.manager.prepare('ternlight-base', false)).rejects.toThrow('deleted');
    expect(f.download).not.toHaveBeenCalled();
  });

  it('틀린 Content-Range 응답은 저장하지 않는다', async () => {
    const f = fixture(
      vi.fn<LocalModelDownload>(() =>
        Promise.resolve({
          status: 206,
          contentRange: 'bytes 2-3/4',
          bytes: new Uint8Array([1, 2]).buffer,
        }),
      ),
    );
    await expect(f.manager.prepare('embeddinggemma-300m')).rejects.toThrow('response');
    expect(f.files.size).toBe(0);
  });
});
