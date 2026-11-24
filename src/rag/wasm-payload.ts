import { gunzipSync, strFromU8, strToU8 } from 'fflate';

// 빌드 생성기와 같은 고정 예산이며 gzip의 ISIZE를 할당 크기로 신뢰하지 않습니다.
const MAX_WASM_BYTES = 8 * 1024 * 1024;
const MAX_GZIP_BYTES = 4 * 1024 * 1024;

export function restoreWasmBase64(
  gzipBase64: string,
  originalLength: number,
  gzipChecksum: number,
): string {
  try {
    if (
      !Number.isSafeInteger(originalLength) ||
      originalLength < 8 ||
      originalLength > MAX_WASM_BYTES ||
      gzipBase64.length > 4 * Math.ceil(MAX_GZIP_BYTES / 3)
    )
      return '';

    const binary = atob(gzipBase64);
    if (binary.length < 20 || binary.length > MAX_GZIP_BYTES) return '';
    const gzip = strToU8(binary, true);
    if (gzip[0] !== 31 || gzip[1] !== 139 || gzip[2] !== 8 || gzip[3] !== 0) return '';
    const view = new DataView(gzip.buffer, gzip.byteOffset, gzip.byteLength);
    if (view.getUint32(4, true) !== 0 || view.getUint32(gzip.length - 4, true) !== originalLength) {
      return '';
    }
    // FNV-1a는 우발적 손상 검사일 뿐 암호학적 무결성 보장이 아닙니다.
    let checksum = 2166136261;
    for (const byte of gzip) checksum = Math.imul(checksum ^ byte, 16777619) >>> 0;
    if (checksum !== gzipChecksum) return '';

    // 출력은 원본 길이 + 초과 감지 1바이트로 고정합니다. 임시 gzip/원본 바이트는 반환 후 해제 가능합니다.
    const wasm = gunzipSync(gzip, { out: new Uint8Array(originalLength + 1) });
    if (wasm.length !== originalLength) return '';
    const header = new DataView(wasm.buffer, wasm.byteOffset, wasm.byteLength);
    if (header.getUint32(0, true) !== 0x6d736100 || header.getUint32(4, true) !== 1) return '';
    return btoa(strFromU8(wasm, true));
  } catch {
    // 빈 payload는 기존 ensureRustCore의 초기화 실패로 닫고 플러그인 import는 유지합니다.
    return '';
  }
}
