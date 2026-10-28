---
id: superpower-architecture
type: architecture-design
status: draft
title: 제품 아키텍처와 실행 경계
parent: superpower-goals
tags: [architecture]
references: [interface-design, chat-contract, vault-evidence, retrieval-index, provider-boundary, external-tools, artifact-storage, deterministic-core, engineering-contract, release-contract, documentation-contract]
---

# 제품 아키텍처와 실행 경계

## 실행 구조

`main.ts`가 Obsidian 수명주기·설정·뷰·검색 런타임·외부 연결을 조립한다. 화면·I/O 조율은 TypeScript, 결정적 계산은 Rust/WASM이 담당한다. 호스트는 Obsidian 데스크톱이며 esbuild CJS 번들로 실행한다. 제품 목적과 품질 요구는 `superpower-goals`, 화면 계약은 기존 `design.md`를 편입한 `interface-design`이 소유한다.

채팅 실행의 현재 중심은 `src/chat/view.ts`다. 별도 controller가 이미 분리됐다고 가정하지 않는다. 검색 화면과 채팅은 공통 색인 입력을 사용하지만 현재 원문 검증의 강도는 동일하지 않다. 검색 화면은 색인 인용과 현재 revision(mtime:size) 대조까지만 수행하고, 채팅의 채택 근거는 현재 본문 재읽기와 구절 재검증을 수행한다.

## 모듈과 의존 경계

- `chat-contract`: 대화 실행·세션·사용자 상호작용을 소유하며 `vault-evidence`, `provider-boundary`, `external-tools`를 조율한다.
- `vault-evidence`: 공통 검색 입력 어댑터(`src/search`)와 `src/agent`의 근거 심사·후속 조사를 묶는 경계다. `retrieval-index`의 후보·코퍼스와 `deterministic-core`의 계획·검증 결과로 dossier를 만들고, `provider-boundary`를 통해 답변을 생성한다. 검색 화면은 같은 입력 어댑터를 별도로 사용한다.
- `retrieval-index`: 원문 코퍼스·BM25·벡터·구조 후보와 색인 준비 상태를 소유한다. 임베딩은 `provider-boundary`, 생성물 수명은 `artifact-storage`, 계산은 `deterministic-core`에 의존한다.
- `provider-boundary`와 `external-tools`: 각각 모델 통신·보안 저장소, MCP transport·연결 상태를 소유하며 결정적 입력 매핑·검증에 `deterministic-core`를 사용한다. 도구 승인은 채팅 실행 경계가 조율한다.
- `artifact-storage`: 플러그인 생성물의 등록·활성 lease·승인된 폐기를 소유하고 폐기 계획 계산은 `deterministic-core`에 맡긴다.
- `deterministic-core`: 호스트 I/O와 독립적인 계산 및 wire 계약을 소유한다. 다른 제품 모듈을 역으로 호출하지 않는다.

이 목록은 구현의 책임을 묶은 초안이며, 디렉터리마다 독립 서비스나 완성된 계층이 존재한다는 뜻은 아니다. 모듈 간 의존의 정본은 이 절이고 각 SPEC은 자기 책임과 실패 경계만 기술한다.

## 공통 계약

TypeScript는 Obsidian DOM·vault I/O·네트워크·MCP 프로세스·IndexedDB와 WASM 입출력을 맡는다. 새 파싱·정규화·검증·선택·랭킹·검색·그래프 계산은 Rust에 둔다. PDF 본문 추출과 페이지 매핑은 기존 pdf.js·Tesseract worker 예외를 유지한다. WASM 실패의 현재 예외는 `deterministic-core`에 명시한다.

비동기 작업은 실행 소유권과 최신 revision/snapshot을 확인한 뒤 상태를 게시한다. 런타임 재초기화 실패는 이전 런타임 복원을 시도하며, 늦은 결과가 새 대화·새 설정을 덮어쓰지 않도록 한다. 원격 요청의 실제 취소 능력은 제공자별 계약과 구분한다.

키 원문은 보안 저장소에만 영속화한다. 문서·모델·도구 결과는 데이터이며 실행 권한을 부여하지 않는다. 외부 근거를 볼트 근거로 승격하지 않는다. 현재 검색 품질을 설명할 때 발견, 현재 원문 검증, LLM 전달, 최종 답변을 별도로 판단한다.

사람용 구현·데이터·검증 계약은 `engineering-contract`, 배포는 `release-contract`, 문서별 정본과 근거/이력 분류는 `documentation-contract`로 연결한다. 이들은 런타임 모듈이나 새 자동화 파이프라인이 아니다.

## 구현 근거와 확인 한계

조립·교체 경계는 `main.ts`의 `onload`, `onunload`, `initRAGRuntime`, `saveSettings`에서 확인한다. 실행 소유권은 `src/chat/run-ownership.ts`, 공통 입력은 `src/search/indexed-search-deps.ts`, 계산 연결은 `src/rag/rust-core.ts`가 주요 근거다. 세부 계약과 회귀 근거는 각 모듈 SPEC에서 연결한다.

이번 편입은 문서 작업이며 제품 동작을 바꾸거나 실제 모델·볼트 검증을 다시 수행하지 않는다. 코드와 목표 계약의 차이는 해당 모듈에서 명시하고, README 및 기존 운영 계약은 임의 재작성하지 않는다.
