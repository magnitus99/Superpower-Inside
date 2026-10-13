import { requestUrl } from 'obsidian';
import { appLogger } from './logger';

export interface ReleaseAssetAdapter {
  exists(path: string): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  rename(path: string, newPath: string): Promise<void>;
}

export interface ReleaseAssetDownloadResult {
  status: number;
  bytes: ArrayBuffer;
}
export type ReleaseAssetDownload = (url: string) => Promise<ReleaseAssetDownloadResult>;

interface ReleaseAssetOptions {
  adapter: ReleaseAssetAdapter;
  path: string;
  url: string;
  size: number;
  sha256: string;
  download?: ReleaseAssetDownload;
}

const preparations = new WeakMap<ReleaseAssetAdapter, Map<string, Promise<ArrayBuffer>>>();

/** 설치·업데이트로 빠진 자산은 검증된 같은 빌드의 바이트로 자동 복구합니다. */
export function ensureReleaseAsset(options: ReleaseAssetOptions): Promise<ArrayBuffer> {
  const available = preparations.get(options.adapter) ?? new Map<string, Promise<ArrayBuffer>>();
  preparations.set(options.adapter, available);
  const key = `${options.path}:${options.sha256}`;
  const existing = available.get(key);
  if (existing) return existing;
  const preparation = prepare(options).finally(() => available.delete(key));
  available.set(key, preparation);
  return preparation;
}

async function prepare(options: ReleaseAssetOptions): Promise<ArrayBuffer> {
  const { adapter, path } = options;
  if (await adapter.exists(path)) {
    const bytes = await adapter.readBinary(path);
    if (await valid(options, bytes)) return bytes;
  }
  appLogger.info('Preparing release asset.', { source: 'assets.release' });
  const response = await (options.download ?? downloadAsset)(options.url);
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Release asset download failed with HTTP ${response.status}.`);
  if (!(await valid(options, response.bytes)))
    throw new Error(
      `Invalid release asset: expected ${options.size} bytes and SHA-256 ${options.sha256}.`,
    );
  const temporary = `${path}.download.tmp`;
  try {
    await adapter.writeBinary(temporary, response.bytes);
    if (await adapter.exists(path)) await adapter.remove(path);
    await adapter.rename(temporary, path);
  } finally {
    try {
      if (await adapter.exists(temporary)) await adapter.remove(temporary);
    } catch {
      // 정리 실패는 원래 저장 오류를 덮어쓰지 않습니다.
      appLogger.warn('Temporary release asset cleanup failed.', { source: 'assets.release' });
    }
  }
  appLogger.notice('Release asset prepared.', { source: 'assets.release' });
  return response.bytes;
}

async function valid(options: ReleaseAssetOptions, bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength !== options.size) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return (
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') ===
    options.sha256
  );
}

async function downloadAsset(url: string): Promise<ReleaseAssetDownloadResult> {
  const response = await requestUrl({ url, method: 'GET', throw: false });
  return { status: response.status, bytes: response.arrayBuffer };
}
