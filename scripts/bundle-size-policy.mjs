export const MAIN_JS_SIZE_LIMIT_BYTES = 5_000_000;

export function needsStrongBundleOptimization(byteLength) {
  return byteLength > MAIN_JS_SIZE_LIMIT_BYTES;
}

export function assertMainJsSize(byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error(`Invalid main.js byte length: ${byteLength}`);
  }
  if (byteLength > MAIN_JS_SIZE_LIMIT_BYTES) {
    throw new Error(
      `main.js is ${byteLength.toLocaleString('en-US')} bytes and exceeds the 5 MB release limit (${MAIN_JS_SIZE_LIMIT_BYTES.toLocaleString('en-US')} bytes).`,
    );
  }
}
