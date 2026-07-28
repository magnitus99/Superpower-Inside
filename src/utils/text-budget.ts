export interface BoundedText {
  text: string;
  truncated: boolean;
}

const DEFAULT_TRUNCATION_MARKER = '\n[Superpower Inside: output truncated]';

/** UTF-8 전송 바이트 상한 안에서 문자열과 명시적인 절단 표식을 함께 보존합니다. */
export function truncateUtf8Text(
  value: string,
  maxBytes: number,
  marker = DEFAULT_TRUNCATION_MARKER,
): BoundedText {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }

  const safeMaxBytes = Math.max(0, Math.trunc(maxBytes));
  const markerBytes = encoder.encode(marker).byteLength;
  const contentBudget = Math.max(0, safeMaxBytes - markerBytes);
  let low = 0;
  let high = Math.min(value.length, contentBudget);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = safeSlice(value, middle);
    if (encoder.encode(candidate).byteLength <= contentBudget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const prefix = safeSlice(value, low);
  if (markerBytes > safeMaxBytes) {
    return { text: prefix, truncated: true };
  }
  return { text: `${prefix}${marker}`, truncated: true };
}

function safeSlice(value: string, end: number): string {
  const lastCodeUnit = value.charCodeAt(end - 1);
  const safeEnd =
    end > 0 && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff ? end - 1 : end;
  return value.slice(0, safeEnd);
}
