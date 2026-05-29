# GraphRAG / Ontology 고급 기능

GraphRAG는 기존 벡터/BM25 RAG 위에 entity, relation, claim, evidence 기반 knowledge graph 후보를 추가하는 고급 검색 기능이다. 기본값은 `OFF`이며, 사용자가 RAG 고급 설정에서 명시적으로 켠 경우에만 LLM 기반 graph 추출 인덱싱을 실행한다.

## 동작 범위

- 기존 RAG 인덱스의 대상 파일과 chunk metadata를 입력으로 사용한다.
- graph 저장소는 Obsidian/Electron의 IndexedDB를 사용한다.
- vector store와 graph store는 분리되어 있으며, graph 데이터는 vault 파일에 JSON으로 저장하지 않는다.
- GraphRAG가 꺼져 있으면 기존 vector/BM25/ANN/structural 검색 경로와 성능은 바뀌지 않는다.

## 개인정보와 비용

GraphRAG 인덱싱은 각 chunk 본문을 선택한 LLM provider로 보내 entity/relation/claim을 추출한다.

- `ollama:*` 모델은 로컬 실행으로 간주한다.
- `openai:*`, `claude:*`, `openRouter:*`, `ollamaCloud:*`, `customOpenAI:*` 모델은 원격 실행으로 간주하며 vault 본문 전송이 발생한다.
- 실행 전 UI는 예상 파일 수, 예상 호출 수, 예상 입력 token 수, 전송/비용 라벨을 표시한다.
- 원격 provider 실행 버튼을 누르면 본문 전송 경고 확인이 한 번 더 표시된다.

민감한 vault에서는 로컬 provider를 사용하거나 GraphRAG를 끈 상태로 유지한다.

## 상태

RAG 설정의 GraphRAG 운영 영역은 다음 상태를 표시한다.

- `disabled`: GraphRAG가 꺼져 있다.
- `not-built`: GraphRAG는 켜졌지만 graph evidence가 아직 없다.
- `building`: graph 인덱싱 실행 중이다.
- `ready`: 현재 vector chunk, 추출 모델, ontology profile/version 기준으로 graph index가 최신이다.
- `partial`: 일부 chunk/file 추출 실패가 있었지만 사용 가능한 evidence-backed graph 후보가 있다.
- `stale`: 파일 content hash, 추출 모델, ontology profile/version이 달라져 재실행이 필요하다.
- `schema-error`: ontology profile 검증 오류가 있어 graph 후보를 사용하지 않는다.

`ready` 또는 `partial`일 때만 query 경로에 GraphRAG 후보가 참여한다. 그 외 상태에서는 조용히 기존 RAG 검색으로 fallback한다.

## 인덱싱 실행

- `시작`: 현재 vector index에 존재하는 파일 중 `graphRagMaxFilesPerRun`까지만 처리한다.
- `취소`: `AbortSignal`을 통해 다음 chunk/file 경계에서 중단한다.
- `이어서 실행`: 이전 실행에서 실패한 파일만 다시 시도한다.

chunk 단위 실패는 `graphRejectedFacts`에 기록하고 다음 chunk/file 처리를 계속한다. 이미 같은 `entryId`, `contentHash`, `extractionModelKey`, `ontologyProfileId`, `ontologyVersion`으로 처리된 chunk는 cache hit로 skip한다.

## Query Mode

- `auto`: 질문 유형을 규칙 기반으로 분류해 local/global/evidence-first를 선택한다.
- `local`: 언급 entity 주변 relation/claim evidence chunk만 후보로 사용한다.
- `global`: community summary 후보만 사용한다.
- `hybrid`: local evidence 후보와 global community 후보를 함께 사용한다.

GraphRAG 후보는 evidence-backed vector chunk 또는 community summary candidate만 컨텍스트에 들어간다.

## 재빌드 조건

다음 변경은 graph index를 `stale`로 만든다.

- 기존 RAG chunk의 `contentHash` 변경
- GraphRAG 추출 모델 변경
- ontology profile 변경
- ontology profile version 변경

stale 상태에서는 기존 RAG로 fallback하며, GraphRAG 인덱싱을 다시 실행하면 cache miss chunk부터 갱신된다.

## 제외 범위

이번 릴리스 후보에서는 다음을 지원하지 않는다.

- JSON graph 저장소
- 모바일 지원
- OWL/RDF/SPARQL 호환
- 대량 merge 전용 UI
