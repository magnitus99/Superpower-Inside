import { ensureReleaseAsset } from '../utils/release-asset';

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

export function buildTernlightReleaseAssetUrl(pluginVersion: string): string {
  return `${RELEASE_BASE_URL}/${encodeURIComponent(pluginVersion)}/${TERNLIGHT_MODEL_FILE_NAME}`;
}

export function ensureTernlightModel(options: EnsureTernlightModelOptions): Promise<ArrayBuffer> {
  return ensureReleaseAsset({
    adapter: options.adapter,
    path: options.modelPath,
    url: buildTernlightReleaseAssetUrl(options.pluginVersion),
    size: TERNLIGHT_MODEL_BYTE_LENGTH,
    sha256: TERNLIGHT_MODEL_SHA256,
    download: options.download,
  });
}
