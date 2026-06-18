# Release 1.3.6

- 이전 버전: 1.3.5
- 커밋 범위: 1.3.5..1.3.6
- 반영 커밋 수: 21

## 주요 변경사항

- `a8746e41` feat(settings): redesign provider management tab
- `1e433764` feat(ui): standardize action button feedback
- `0ccef6bc` feat(rag): manage retrieval layers automatically
- `12a2a550` feat(settings): show GraphRAG storage progress
- `68a7c184` feat(graphrag): track chunk storage progress
- `61a06773` feat(graphrag): preserve multilingual entity labels

## 버그 수정

- `f0fa03e0` fix(settings): explain GraphRAG no-op indexing results
- `84758541` fix(rag): skip oversized legacy snapshots on startup
- `2db0dc7b` fix(startup): defer heavy runtime initialization

## 성능 / 안정성 / 운영 개선

- `a5a7da84` perf(rag): skip unchanged file reindexing
- `dcc1f341` perf(rag): persist BM25 updates incrementally

## 문서 / 기타

- `f823d26c` docs(release): add 1.3.5 release notes
- `f16126fd` docs(qa): require visual review for UI changes
- `5474b1c8` chore(release): 1.3.6
- `da1d4596` build(plugin): refresh generated bundle
- `31aa3f19` build(plugin): refresh generated bundle
- `c22ec59b` build(plugin): refresh generated bundle
- `662c922e` build: update plugin bundle
- `5ed088d2` build: refresh bundled plugin artifact
- `db1963ce` build: refresh bundled plugin artifact
- `a6625a60` Fix GraphRAG failed retries and live status
