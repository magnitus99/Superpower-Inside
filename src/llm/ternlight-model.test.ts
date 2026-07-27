import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TERNLIGHT_MODEL_FILE_NAME,
  TERNLIGHT_MODEL_SHA256,
  buildTernlightReleaseAssetUrl,
  ensureTernlightModel,
  type TernlightModelAdapter,
  type TernlightModelDownload,
} from './ternlight-model';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

const MODEL_PATH = `.obsidian/plugins/superpower-inside/${TERNLIGHT_MODEL_FILE_NAME}`;
const PLUGIN_VERSION = '1.4.2';
const validModel = toArrayBuffer(
  readFileSync(join(process.cwd(), TERNLIGHT_MODEL_FILE_NAME)),
);

describe('ensureTernlightModel', () => {
  let adapter: MemoryModelAdapter;

  beforeEach(() => {
    adapter = new MemoryModelAdapter();
  });

  it('검증된 로컬 모델은 네트워크 요청 없이 재사용한다', async () => {
    adapter.files.set(MODEL_PATH, validModel);
    const download = vi.fn<TernlightModelDownload>();

    const result = await ensureTernlightModel({
      adapter,
      modelPath: MODEL_PATH,
      pluginVersion: PLUGIN_VERSION,
      download,
    });

    expect(result).toEqual(validModel);
    expect(download).not.toHaveBeenCalled();
    expect(adapter.writeBinary).not.toHaveBeenCalled();
  });

  it('모델이 없으면 현재 플러그인 릴리즈에서 내려받아 원자적으로 저장한다', async () => {
    const download = vi.fn<TernlightModelDownload>().mockResolvedValue({
      status: 200,
      bytes: validModel,
    });

    const result = await ensureTernlightModel({
      adapter,
      modelPath: MODEL_PATH,
      pluginVersion: PLUGIN_VERSION,
      download,
    });

    expect(result).toEqual(validModel);
    expect(download).toHaveBeenCalledWith(buildTernlightReleaseAssetUrl(PLUGIN_VERSION));
    expect(adapter.files.get(MODEL_PATH)).toEqual(validModel);
    expect([...adapter.files.keys()]).toEqual([MODEL_PATH]);
  });

  it('손상된 로컬 모델은 검증된 다운로드로 교체한다', async () => {
    const corrupted = corrupt(validModel);
    adapter.files.set(MODEL_PATH, corrupted);
    const download = vi.fn<TernlightModelDownload>().mockResolvedValue({
      status: 200,
      bytes: validModel,
    });

    await expect(
      ensureTernlightModel({
        adapter,
        modelPath: MODEL_PATH,
        pluginVersion: PLUGIN_VERSION,
        download,
      }),
    ).resolves.toEqual(validModel);

    expect(adapter.files.get(MODEL_PATH)).toEqual(validModel);
  });

  it('체크섬이 다른 다운로드는 최종 경로에 기록하지 않는다', async () => {
    const corrupted = corrupt(validModel);
    const download = vi.fn<TernlightModelDownload>().mockResolvedValue({
      status: 200,
      bytes: corrupted,
    });

    await expect(
      ensureTernlightModel({
        adapter,
        modelPath: MODEL_PATH,
        pluginVersion: PLUGIN_VERSION,
        download,
      }),
    ).rejects.toThrow(`SHA-256 ${TERNLIGHT_MODEL_SHA256}`);

    expect(adapter.files.has(MODEL_PATH)).toBe(false);
    expect(adapter.writeBinary).not.toHaveBeenCalled();
  });

  it('동시 준비 요청은 하나의 다운로드로 합친다', async () => {
    let releaseDownload: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    const download = vi.fn<TernlightModelDownload>().mockImplementation(async () => {
      await gate;
      return { status: 200, bytes: validModel };
    });

    const first = ensureTernlightModel({
      adapter,
      modelPath: MODEL_PATH,
      pluginVersion: PLUGIN_VERSION,
      download,
    });
    const second = ensureTernlightModel({
      adapter,
      modelPath: MODEL_PATH,
      pluginVersion: PLUGIN_VERSION,
      download,
    });
    releaseDownload?.();

    await expect(Promise.all([first, second])).resolves.toEqual([validModel, validModel]);
    expect(download).toHaveBeenCalledTimes(1);
  });
});

class MemoryModelAdapter implements TernlightModelAdapter {
  readonly files = new Map<string, ArrayBuffer>();
  readonly writeBinary = vi.fn((path: string, data: ArrayBuffer): Promise<void> => {
    this.files.set(path, data);
    return Promise.resolve();
  });

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.files.get(path);
    return value
      ? Promise.resolve(value)
      : Promise.reject(new Error(`Missing test file: ${path}`));
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  rename(path: string, newPath: string): Promise<void> {
    const value = this.files.get(path);
    if (!value) return Promise.reject(new Error(`Missing test file: ${path}`));
    this.files.delete(path);
    this.files.set(newPath, value);
    return Promise.resolve();
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function corrupt(bytes: ArrayBuffer): ArrayBuffer {
  const copy = bytes.slice(0);
  const view = new Uint8Array(copy);
  view[view.length - 1] ^= 0xff;
  return copy;
}
