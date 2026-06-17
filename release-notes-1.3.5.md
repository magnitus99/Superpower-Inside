# Release 1.3.5

- 이전 버전: 1.3.4
- 커밋 범위: 1.3.4..1.3.5
- 반영 커밋 수: 13

## 주요 변경사항

- `1a05700e` feat: complete chat ux and rag performance work
- `e122dd6a` feat: improve chat runtime recovery ux
- `d82b8b3b` feat: preserve chat replay schema
- `2e15275d` feat: add chat turn state machine
- `c3327b0b` feat: add provider capability contract

## 버그 수정

- `4ccf430c` fix(graphrag): align relation extraction schema

## 성능 / 안정성 / 운영 개선

- `05183575` perf(rag): limit bm25 bridge results
- `468476e1` perf: speed up RAG token dedupe
- `a8b98179` perf(rag): append BM25 docs during rebuild
- `0af70bf8` perf(rag): yield during BM25 rebuild

## 문서 / 기타

- `2ad08793` chore(release): 1.3.5
- `0fe78fdd` test: add chat ux fixture gate
- `ff4e55f1` refactor: split chat view rendering modules
