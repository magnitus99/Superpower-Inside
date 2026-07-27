import { requestUrl } from 'obsidian';

export const TERNLIGHT_MODEL_FILE_NAME = 'tern_engine_bg.wasm';
export const TERNLIGHT_MODEL_BYTE_LENGTH = 10_228_415;
export const TERNLIGHT_MODEL_SHA256 =
  '27819b70b83fb24a493792db7bdf6b9cae4a1531df408809d1e57d580a3e9087';

const RELEASE_BASE_URL = 'https://github.com/magnitus99/Superpower-Inside/releases/download';

export interface TernlightModelAdapter {
  exists(path: string): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  rename(path: string, newPath: string): Promise<void>;
}

export interface TernlightModelDownloadResult {
  status: number;
  bytes: ArrayBuffer;
}

export type TernlightModelDownload = (url: string) => Promise<TernlightModelDownloadResult>;

export interface EnsureTernlightModelOptions {
  adapter: TernlightModelAdapter;
  modelPath: string;
  pluginVersion: string;
  download?: TernlightModelDownload;
}

const preparations = new WeakMap<object, Map<string, Promise<ArrayBuffer>>>();

export function buildTernlightReleaseAssetUrl(pluginVersion: string): string {
  return `${RELEASE_BASE_URL}/${encodeURIComponent(pluginVersion)}/${TERNLIGHT_MODEL_FILE_NAME}`;
}

export function ensureTernlightModel(options: EnsureTernlightModelOptions): Promise<ArrayBuffer> {
  const adapterKey = options.adapter as object;
  const adapterPreparations = preparations.get(adapterKey) ?? new Map<string, Promise<ArrayBuffer>>();
  preparations.set(adapterKey, adapterPreparations);

  const existing = adapterPreparations.get(options.modelPath);
  if (existing) return existing;

  const preparation = prepareTernlightModel(options).finally(() => {
    adapterPreparations.delete(options.modelPath);
  });
  adapterPreparations.set(options.modelPath, preparation);
  return preparation;
}

async function prepareTernlightModel(
  options: EnsureTernlightModelOptions,
): Promise<ArrayBuffer> {
  if (await options.adapter.exists(options.modelPath)) {
    const localBytes = await options.adapter.readBinary(options.modelPath);
    if (await isValidTernlightModel(localBytes)) {
      return localBytes;
    }
  }

  const download = options.download ?? downloadTernlightModel;
  const url = buildTernlightReleaseAssetUrl(options.pluginVersion);
  const response = await download(url);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ternlight model download failed with HTTP ${response.status}: ${url}`);
  }
  await assertValidTernlightModel(response.bytes);
  await replaceModelAtomically(options.adapter, options.modelPath, response.bytes);
  return response.bytes;
}

async function downloadTernlightModel(url: string): Promise<TernlightModelDownloadResult> {
  const response = await requestUrl({ url, method: 'GET', throw: false });
  return { status: response.status, bytes: response.arrayBuffer };
}

async function isValidTernlightModel(bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength !== TERNLIGHT_MODEL_BYTE_LENGTH) return false;
  return (await calculateSha256(bytes)) === TERNLIGHT_MODEL_SHA256;
}

async function assertValidTernlightModel(bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength !== TERNLIGHT_MODEL_BYTE_LENGTH) {
    throw new Error(
      `Invalid Ternlight model size: expected ${TERNLIGHT_MODEL_BYTE_LENGTH}, received ${bytes.byteLength}`,
    );
  }
  const checksum = await calculateSha256(bytes);
  if (checksum !== TERNLIGHT_MODEL_SHA256) {
    throw new Error(
      `Invalid Ternlight model checksum: expected SHA-256 ${TERNLIGHT_MODEL_SHA256}, received ${checksum}`,
    );
  }
}

async function calculateSha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function replaceModelAtomically(
  adapter: TernlightModelAdapter,
  modelPath: string,
  bytes: ArrayBuffer,
): Promise<void> {
  const temporaryPath = `${modelPath}.download-${Date.now()}.tmp`;
  await adapter.writeBinary(temporaryPath, bytes);
  try {
    if (await adapter.exists(modelPath)) {
      await adapter.remove(modelPath);
    }
    await adapter.rename(temporaryPath, modelPath);
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath);
      }
    } catch {
      // 임시 파일 정리 실패는 원래 저장 오류를 대체하지 않는다.
    }
    throw error;
  }
}
