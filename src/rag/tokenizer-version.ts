/**
 * 검색 토큰 규칙 버전입니다.
 *
 * 단일 출처는 Rust의 `TOKENIZER_VERSION`이며, 이 값은 그 사본입니다.
 * `src/rag/tokenizer-version.test.ts`가 실제 WASM 값과 비교하므로 두 값이
 * 어긋나면 테스트가 실패합니다. 저장된 BM25 스냅샷은 버전이 다르면 다시 만듭니다.
 */
export const TOKENIZER_VERSION = 3;
