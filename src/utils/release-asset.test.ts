import { describe, expect, it, vi } from 'vitest';
import { ensureReleaseAsset, type ReleaseAssetAdapter } from './release-asset';

function fixture() {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const files = new Map<string, ArrayBuffer>();
  const adapter: ReleaseAssetAdapter = {
    exists: (path) => Promise.resolve(files.has(path)),
    readBinary: (path) => Promise.resolve(files.get(path) ?? new ArrayBuffer(0)),
    writeBinary: (path, data) => {
      files.set(path, data);
      return Promise.resolve();
    },
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
    rename: (from, to) => {
      files.set(to, files.get(from) ?? new ArrayBuffer(0));
      files.delete(from);
      return Promise.resolve();
    },
  };
  const download = vi.fn().mockResolvedValue({ status: 200, bytes });
  const options = {
    adapter,
    path: 'plugin/worker.js',
    url: 'https://example.invalid/1.2.3/worker.js',
    size: 4,
    sha256: '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
    download,
  };
  return { bytes, files, options, download };
}

describe('릴리스 자산 자동 준비', () => {
  it('같은 크기의 손상된 파일은 검증 후 교체하고 정상 파일은 오프라인으로 재사용한다', async () => {
    const { bytes, files, options, download } = fixture();
    files.set(options.path, new Uint8Array([4, 3, 2, 1]).buffer);
    await expect(ensureReleaseAsset(options)).resolves.toEqual(bytes);
    await expect(ensureReleaseAsset(options)).resolves.toEqual(bytes);
    expect(download).toHaveBeenCalledTimes(1);
    expect([...files.keys()]).toEqual([options.path]);
  });
  it('동시 요청은 다운로드를 공유하고 실패 후 다음 요청에서 자동 재시도한다', async () => {
    const { bytes, files, options, download } = fixture();
    download.mockResolvedValueOnce({ status: 503, bytes });
    await expect(
      Promise.all([ensureReleaseAsset(options), ensureReleaseAsset(options)]),
    ).rejects.toThrow('HTTP 503');
    expect(files.size).toBe(0);
    await expect(ensureReleaseAsset(options)).resolves.toEqual(bytes);
    expect(download).toHaveBeenCalledTimes(2);
  });
  it('검증에 실패한 다운로드는 실행할 파일로 저장하지 않고 기존 파일을 보존한다', async () => {
    const { files, options, download } = fixture();
    const old = new Uint8Array([9, 9, 9, 9]).buffer;
    files.set(options.path, old);
    download.mockResolvedValue({ status: 200, bytes: old });
    await expect(ensureReleaseAsset(options)).rejects.toThrow('SHA-256');
    expect([...files.keys()]).toEqual([options.path]);
    expect(files.get(options.path)).toBe(old);
  });
  it('저장 실패 시 임시 파일을 정리하고 다음 요청이 복구를 다시 시도한다', async () => {
    const { files, options, bytes } = fixture();
    const rename = vi.spyOn(options.adapter, 'rename');
    rename.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(ensureReleaseAsset(options)).rejects.toThrow('storage unavailable');
    expect(files.size).toBe(0);
    await expect(ensureReleaseAsset(options)).resolves.toEqual(bytes);
  });

  it('임시 파일 정리 오류는 원래 저장 실패를 덮어쓰지 않는다', async () => {
    const { options } = fixture();
    vi.spyOn(options.adapter, 'rename').mockRejectedValue(new Error('storage unavailable'));
    vi.spyOn(options.adapter, 'remove').mockRejectedValue(new Error('cleanup unavailable'));
    await expect(ensureReleaseAsset(options)).rejects.toThrow('storage unavailable');
  });
});
