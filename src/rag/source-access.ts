import type { TFile, Vault } from 'obsidian';
import {
  extractSourceTextRust,
  isExtractableSourceExtensionRust,
  type RustSourceTextSegment,
} from './rust-core';

/** 추출 본문에서 라벨이 붙은 구간입니다. 줄 번호는 0부터 셉니다. */
export type SourceTextSegment = RustSourceTextSegment;

export interface SourceText {
  text: string;
  segments: readonly SourceTextSegment[];
}

/** 같은 파일을 동시에 읽는 소비자가 추출을 중복 실행하지 않도록 합니다. */
const pendingReads = new Map<string, Promise<SourceText>>();
/** 재색인 중 같은 원문을 반복 추출하지 않기 위한 최근 사용 캐시입니다. */
const recentReads = new Map<string, SourceText>();
const RECENT_READ_CHAR_LIMIT = 8 * 1024 * 1024;
let recentReadChars = 0;

/**
 * 볼트 원문 읽기의 단일 진입점입니다.
 *
 * 일반 텍스트는 그대로 읽고, 추출 지원 문서는 바이트를 결정적 추출기에 넘깁니다.
 * `RAG`·`BM25`·임베딩·네이티브 도구·채팅 컨텍스트가 모두 이 함수를 통해 같은 본문을 봅니다.
 */
export async function readSourceText(vault: Vault, file: TFile): Promise<SourceText> {
  if (isExtractableSourceExtensionRust(file.extension ?? '') !== true)
    return { text: await vault.cachedRead(file), segments: [] };

  const key = sourceCacheKey(file);
  const cached = recentReads.get(key);
  if (cached) return cached;
  const pending = pendingReads.get(key);
  if (pending) return pending;

  const read = extractSourceText(vault, file)
    .then((result) => {
      remember(key, result);
      return result;
    })
    .finally(() => {
      pendingReads.delete(key);
    });
  pendingReads.set(key, read);
  return read;
}

/** 추출 결과가 없으면 호출자가 파일 단위로 실패를 처리하도록 오류를 던집니다. */
async function extractSourceText(vault: Vault, file: TFile): Promise<SourceText> {
  const bytes = new Uint8Array(await vault.readBinary(file));
  const extracted = extractSourceTextRust(file.extension ?? '', bytes);
  if (!extracted)
    throw new Error(`Source text extraction is unavailable for ${file.path}.`);
  if (!extracted.ok)
    throw new Error(
      `Source text extraction failed for ${file.path} (${extracted.reason ?? 'unknown'}).`,
    );
  return { text: extracted.text, segments: extracted.segments };
}

/** 캐시가 본문 길이 상한을 넘지 않도록 가장 오래된 항목부터 비웁니다. */
function remember(key: string, result: SourceText): void {
  recentReads.set(key, result);
  recentReadChars += result.text.length;
  while (recentReadChars > RECENT_READ_CHAR_LIMIT && recentReads.size > 1) {
    const oldest = recentReads.keys().next();
    if (oldest.done) break;
    const evicted = recentReads.get(oldest.value);
    recentReads.delete(oldest.value);
    recentReadChars = Math.max(0, recentReadChars - (evicted?.text.length ?? 0));
  }
}

function sourceCacheKey(file: TFile): string {
  return `${file.path}\u0000${file.stat.mtime}\u0000${file.stat.size}`;
}

/** 테스트와 다시 읽기에서 이전 revision 본문이 남지 않도록 캐시를 비웁니다. */
export function clearSourceTextCache(): void {
  pendingReads.clear();
  recentReads.clear();
  recentReadChars = 0;
}
