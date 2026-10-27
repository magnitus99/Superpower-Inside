---
id: retrieval-index
type: module-design
status: draft
title: 원문 코퍼스와 검색 색인
parent: superpower-architecture
references: [vault-evidence]
---

# 원문 코퍼스와 검색 색인

## 책임과 경계

접근 가능한 vault 파일의 원문 코퍼스와 lexical·vector·structural 후보를 준비한다. 검색 순위는 조사 신호이지 최종 답변 근거 자격이 아니다. 원문 검증·답변 심사는 `vault-evidence`가 소유한다. 단어 검색은 임베딩 성공에 종속시키지 않는다.

제외 정책은 `getRagCandidateFiles`와 Rust indexability 계획에서 적용한다. 경로·확장자·채팅 폴더·파일별 YAML 제외는 플러그인 설정을 기준으로 한다. Obsidian 파일 탐색기에 보인다는 이유만으로 검색 대상에 넣거나 Git 제외라는 이유만으로 검색에서 빼지 않는다. 정책 변경 뒤의 잔여 색인 소거와 실제 적용 여부는 별도 검증 대상이다.

## 저장·준비·실패

원문 코퍼스 갱신과 임베딩 색인은 분리돼 있다. BM25 저장이 임베딩보다 먼저 수행되므로 임베딩 실패를 lexical 자료 부재로 처리하지 않는다. 늦게 도착한 벡터는 현재 snapshot과 제외 정책을 확인한 뒤 반영한다. corpus·BM25·vector 전체를 묶는 단일 transaction은 현재 보장이 아니다.

corpus refresh·pending update·색인이 진행 중이면 공통 readiness가 preparing/indexing을 나타낸다. corpus 또는 BM25가 존재한다는 사실과 dense/hybrid를 포함한 전체 검색 준비 완료를 혼동하지 않는다. 취소·교체·읽기 실패와 정상 빈 결과를 구분한다.

청킹 세대와 legacy 직렬화 호환성을 보존한다. Markdown의 헤딩·코드블록·위키링크·임베드 경계를 단순 줄바꿈 분할로 대체하지 않는다. 캐시와 색인은 재생성 가능한 생성물이지만 사용자 노트·세션은 아니다.

## 구현·검증 근거

`vault-document-corpus.ts`, `indexer.ts`의 `VaultIndexer`, `query.ts`의 `RAGQueryEngine`, `retrieval-pipeline.ts`의 `RetrievalOrchestrator`가 책임의 근거다. 파일별 corpus transaction은 `document-corpus-store.ts`, 저장 세대는 `storage-lifecycle.ts`에서 확인한다. 관련 회귀 근거는 `indexer.test.ts`, `query.test.ts`, `document-corpus-store.test.ts`, `storage-lifecycle.test.ts`다.

이 문서는 준비·보존의 의도와 관찰된 보호 장치를 기록한다. 색인 전체의 무누락·실제 볼트 정책 소거·재시작 후 단서 보존을 이번 편입에서 실행 검증한 것은 아니다.
