/** 원문 범위는 codepoint를 보존하며 끝 주소는 exclusive입니다. */
export interface RustSourceBodyBlockRange {
  startByte: number;
  endByte: number;
  startUtf16: number;
  endUtf16: number;
}

export interface RustSourceBodyPlan {
  version: 1;
  byteLength: number;
  utf16Length: number;
  scanChargeBytes: number;
  blocks: readonly RustSourceBodyBlockRange[];
}

/** 계산을 재현하지 않고 원문 I/O에 쓸 Rust 범위 wire만 검증합니다. */
export function isRustSourceBodyPlan(value: unknown, text?: string): value is RustSourceBodyPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Partial<RustSourceBodyPlan>;
  if (plan.version !== 1 || !safeSize(plan.byteLength) || !safeSize(plan.utf16Length) ||
      plan.utf16Length > plan.byteLength || plan.byteLength > plan.utf16Length * 3 ||
      !Number.isSafeInteger(plan.scanChargeBytes) || plan.scanChargeBytes! < plan.byteLength ||
      !Array.isArray(plan.blocks) || (text !== undefined && text.length !== plan.utf16Length)) return false;
  let byteEnd = 0, utf16End = 0;
  const blocks: readonly unknown[] = plan.blocks;
  for (const value of blocks) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const block = value as Partial<RustSourceBodyBlockRange>;
    if (!safeSize(block.startByte) || !safeSize(block.endByte) || !safeSize(block.startUtf16) || !safeSize(block.endUtf16) ||
        block.startByte !== byteEnd || block.startUtf16 !== utf16End ||
        block.endByte <= byteEnd || block.endUtf16 <= utf16End ||
        block.endByte > plan.byteLength || block.endUtf16 > plan.utf16Length || block.endByte - byteEnd > 64 * 1024) return false;
    if (text !== undefined && block.endUtf16 < text.length &&
        text.charCodeAt(block.endUtf16) >= 0xdc00 && text.charCodeAt(block.endUtf16) <= 0xdfff &&
        text.charCodeAt(block.endUtf16 - 1) >= 0xd800 && text.charCodeAt(block.endUtf16 - 1) <= 0xdbff) return false;
    byteEnd = block.endByte;
    utf16End = block.endUtf16;
  }
  return byteEnd === plan.byteLength && utf16End === plan.utf16Length;
}

function safeSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1024 * 1024 * 1024;
}
