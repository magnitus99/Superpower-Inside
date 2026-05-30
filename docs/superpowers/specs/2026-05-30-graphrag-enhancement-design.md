# GraphRAG 고도화 설계

**작성일:** 2026-05-30  
**상태:** 초안  
**관련 브랜치:** feat/chat-research-copilot

---

## 목차

1. [현황 분석](#1-현황-분석)
2. [전체 구조](#2-전체-구조)
3. [Phase 1: 인덱싱/데이터 계층](#3-phase-1-인덱싱데이터-계층)
4. [Phase 2: 검색/채팅 계층](#4-phase-2-검색채팅-계층)
5. [Phase 3: UI/시각화 계층](#5-phase-3-ui시각화-계층)
6. [전체 Anti-Patterns & 주의사항](#6-전체-anti-patterns--주의사항)
7. [테스트 전략](#7-테스트-전략)
8. [릴리스 계획](#8-릴리스-계획)

---

## 1. 현황 분석

### 1.1 이미 구현된 기능

**Knowledge Graph Store** (`src/graph/store.ts`)
- IndexedDB 기반 `IndexedDbKnowledgeGraphStore`
- 엔티티(`GraphEntityRecord`), 관계(`GraphRelationRecord`), 클레임(`GraphClaimRecord`)
- 증거(`GraphEvidenceRecord`), 커뮤니티(`GraphCommunityRecord`), 거부된 사실(`GraphRejectedFactRecord`)
- 추출 캐시(`GraphExtractionCacheRecord`), 보류 병합(`PendingEntityMergeRecord`)
- `InMemoryKnowledgeGraphStore` 테스트용 구현

**Entity Extraction** (`src/graph/extraction.ts`)
- `GraphExtractionIndexer` — LLM 기반 엔티티/관계/클레임 추출
- 온톨로지 검증 (`validateOntologyRelation`)
- 추출 결과 캐싱 (`isExtractionCached` / `markExtractionCached`)
- JSON 파싱 및 타입 가드

**Entity Resolution** (`src/graph/entity-resolver.ts`)
- `EntityResolver` — 이름/별칭/설명 기반 유사도 점수 계산
- 3단계: auto-merge(≥0.88) / pending-merge(≥0.72) / new
- `normalizeEntityName` — 한글/영문 혼합 정규화

**Community Detection** (`src/graph/community-detector.ts`)
- Louvain-like modularity 최적화 알고리즘
- `buildEdges` / `detectCommunities`

**Community Summarization** (`src/graph/community-summarizer.ts`)
- `CommunitySummarizer` — LLM으로 커뮤니티 요약 생성
- 요약에 대한 임베딩(`summaryVector`) 저장
- 한국어(2-4문장) 요약 생성

**Query Engine** (`src/graph/query-engine.ts`)
- `GraphRagQueryEngine` — local/global/hybrid/auto 쿼리 모드
- `planGraphQuery` — 질문 유형 자동 분류 (factual/relational/thematic/comparative/source-seeking/ordinary-rag)
- `GraphRagCandidateProvider` — RagRetrievalPipeline 통합 (deadlineMs=180)

**Status** (`src/graph/status.ts`)
- `calculateGraphRagStatus` — 7가지 상태 (disabled/not-built/building/ready/partial/stale/schema-error)

**View** (`src/graph/view.ts`)
- `GraphRagView` — ItemView, 698줄
- 5개 탭: entities / relations / evidence / communities / rejected
- 검색, 신뢰도 필터, 엔티티 상세, 관계 그래프 탐색

**Integration**

| 위치 | 역할 |
|------|------|
| `main.ts` | `GraphRagIndexingRunner` / `GraphRagQueryEngine` 생성, 자동 동기화, 상태 갱신 타이머, 파일 변경 리스너 |
| `src/rag/retrieval-pipeline.ts` | `GraphRagCandidateProvider` 포함한 5개 CandidateProvider |
| `src/rag/query.ts` | `getRetrievalSourceBoost` — graph-source 부스트 로직 |
| `src/chat/context.ts` | `@entity` 멘션 처리 → `appendGraphEntityContext` |
| `src/chat/mention-parser.ts` | `@entity:Name` 파싱 |
| `src/settings.ts` | `RAGConfig.graphRagEnabled`, `graphRagModel`, `graphRagQueryMode` 등 |
| `src/rag/settings-display.ts` | `getGraphRagControlState`, `estimateGraphRagIndexingCost`, `getGraphRagStatusPresentation` |
| `src/ontology/schema.ts` | `DEFAULT_ONTOLOGY_SCHEMA` — 8개 entity type, 10개 relation type, 3개 claim type |
| `src/i18n.ts` | GraphRAG 관련 한국어/영어 문자열 |

### 1.2 개선이 필요한 영역

| 영역 | 현재 | 목표 |
|------|------|------|
| **인덱싱** | 전체 파일 대상 batch 실행만 가능 | 파일 변경 시 증분 처리 |
| **커뮤니티** | 단일 레벨(level 0) 플랫 구조 | 계층적 멀티레벨 커뮤니티 |
| **품질 메트릭** | 없음 | 엔티티/관계 통계, 신뢰도 분포, 커버리지 |
| **온톨로지** | 코드 내 `DEFAULT_ONTOLOGY_SCHEMA` 하드코딩 | 파일 기반 사용자 정의 온톨로지 |
| **엔티티 감지** | `@entity:Name` 명시적 멘션만 | 질문 텍스트 자동 엔티티 매칭 |
| **컨텍스트 포맷** | 단순 마크다운 리스트 | 관계 구조 포함 풍부한 포맷 |
| **채팅 명령어** | 없음 | `/graph` 인라인 명령어 |
| **검색 랭킹** | 고정 부스트(0.68) | 동적 점수 (confidence/density/freshness) |
| **그래프 시각화** | 플랫 리스트 | D3.js force-directed graph |
| **커뮤니티 맵** | 플랫 리스트 | 카드 맵 뷰 |
| **온톨로지 편집기** | 없음 | GUI 온톨로지 편집기 |
| **설정 UI** | 기본 설정 필드 | 상태 대시보드, 비용 추정 |
| **엔티티 브라우징** | 타입 그룹 + 검색 | 아코디언, 연관 탐색, 그래프 연동 |

---

## 2. 전체 구조

### 2.1 Phase 의존성

```
Phase 1 (데이터/인덱싱)
  ├─ 1.1 증분 인덱싱 ──→ Phase 2.2 (신선한 데이터)
  ├─ 1.2 멀티레벨 커뮤니티 ──→ Phase 2.4 (계층적 검색)
  ├─ 1.3 품질 메트릭 ──→ Phase 3.4 (대시보드)
  └─ 1.4 다중 온톨로지 ──→ Phase 3.3 (편집기)

Phase 2 (검색/채팅)
  ├─ 2.1 자동 엔티티 감지 ──→ Phase 2.2 (포맷 개선)
  ├─ 2.2 구조화된 컨텍스트 포맷
  ├─ 2.3 /graph 명령어
  └─ 2.4 검색 랭킹 개선

Phase 3 (UI/시각화)
  ├─ 3.1 그래프 시각화 ──╼ 1.2, 3.5
  ├─ 3.2 커뮤니티 맵 ──╼ 1.2
  ├─ 3.3 온톨로지 편집기 ──╼ 1.4
  ├─ 3.4 설정 UI 개선 ──╼ 1.3
  └─ 3.5 엔티티 브라우징 UX ──╼ 3.1
```

### 2.2 변경 대상 파일 목록

| 구분 | 파일 | Phase | 변경 유형 |
|------|------|-------|-----------|
| 신규 | `src/graph/metrics.ts` | 1.3 | 생성 |
| 신규 | `src/ontology/loader.ts` | 1.4 | 생성 |
| 신규 | `src/chat/commands.ts` | 2.3 | 생성 |
| 신규 | `src/graph/graph-renderer.ts` | 3.1 | 생성 |
| 신규 | `src/ontology/editor.ts` | 3.3 | 생성 |
| 수정 | `src/graph/indexing-runner.ts` | 1.1, 1.2 | 확장 |
| 수정 | `src/graph/community-detector.ts` | 1.2 | 확장 |
| 수정 | `src/graph/community-summarizer.ts` | 1.2 | 확장 |
| 수정 | `src/graph/status.ts` | 1.3 | 확장 |
| 수정 | `src/graph/query-engine.ts` | 1.2, 2.4 | 확장 |
| 수정 | `src/graph/store.ts` | 1.2 | 마이너 |
| 수정 | `src/graph/view.ts` | 3.1, 3.2, 3.5 | 대폭 확장 |
| 수정 | `src/rag/query.ts` | 2.4 | 수정 |
| 수정 | `src/rag/settings-display.ts` | 1.3 | 확장 |
| 수정 | `src/chat/context.ts` | 2.1, 2.2 | 확장 |
| 수정 | `src/chat/view.ts` | 2.3 | 마이너 |
| 수정 | `src/chat/mention-parser.ts` | 2.1 | 마이너 |
| 수정 | `src/settings.ts` | 1.4, 3.4 | 확장 |
| 수정 | `src/i18n.ts` | 전 Phase | 확장 |
| 수정 | `main.ts` | 1.1, 1.3, 1.4 | 수정 |
| 수정 | `styles.css` | 3.1 | 확장 |
| 수정 | `package.json` | 3.1 | 의존성 추가 |

---

## 3. Phase 1: 인덱싱/데이터 계층

### 3.1 증분 GraphRAG 인덱싱

**현재:** `GraphRagIndexingRunner.run()`이 모든 candidate 파일 전체를 대상으로 동기 실행. 파일 하나가 변경되어도 전체 재인덱싱 필요.

**목표:** 파일 변경 시 해당 파일의 chunk만 LLM 재추출, 영향받은 커뮤니티만 부분 재요약.

**변경 파일:** `src/graph/indexing-runner.ts`, `src/graph/community-detector.ts`, `main.ts`

#### 구현 항목 (Must Have)

```
[Method] GraphRagIndexingRunner.incrementalRun(filePaths: string[], signal?: AbortSignal)
    : Promise<GraphRagIndexingResult>
```

- 변경된 파일 경로 목록만 받아서 처리
- `vectorStore.getEntriesByFilePaths()`로 해당 파일의 chunk 조회
- 캐시 체크(`isExtractionCached`) → contentHash/model/ontology 변경된 chunk만 재추출
- `extractChunk()` 호출 (기존 재사용)
- 증분 처리 결과 반환 (processedChunks, skippedChunks, failedChunks)

```
[Method] GraphRagIndexingRunner.partialRebuildCommunities(
    affectedEntityIds: Set<string>,
    signal?: AbortSignal,
): Promise<void>
```

- 변경된 엔티티가 속한 커뮤니티 ID 수집
- 해당 커뮤니티만 LLM 재요약
- 커뮤니티 구조가 바뀌지 않았다면 기존 entityCommunityMap 재사용
- 기존 `summarizeCommunities`의 부분 실행 경로

```
[Integration] main.ts — 파일 변경 리스너 확장
```

- `vault.on('modify')` → RAG 인덱싱 완료 후 `graphRagEnabled && incrementalRun([path])` 호출
- `vault.on('delete')` → `cleanupGraphRagForDeletedFiles(filePaths)` 확장:
  - 해당 파일의 evidence, extraction cache, rejected facts 정리
  - 증거가 0이 된 엔티티는 confidence 50%로 낮춤 (삭제하지 않음)
  - 증거가 0이 된 관계/클레임은 hard-delete
- `vault.on('rename')` → 기존 엔티티/관계의 filePath 업데이트

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 변경과 무관한 커뮤니티 전체 재요약 | 불필요한 LLM 호출 |
| 삭제된 파일의 엔티티 hard-delete | 다른 파일에 증거가 있을 수 있음 |
| 증분 처리 시에도 전체 candidate 파일 스캔 | O(n) 대신 O(k) 유지 (k=변경 파일 수) |
| VaultIndexer와 GraphRAGIndexer를 같은 큐에서 동기 실행 | RAGIndexingScheduler debounce와 충돌 가능성 |

#### 주의사항

- LLM 추출 결과가 이전과 달라질 수 있음 → `EntityResolver.resolve()`가 기존 엔티티와 병합하므로 ID 일관성은 유지되나 description/aliases가 바뀔 수 있음
- `KnowledgeGraphStore.upsertEntity()`는 merge 로직이 있으므로 안전함
- 부분 커뮤니티 재요약 시 이전 요약을 프롬프트에 포함하여 일관성 유지
- `RAGIndexingScheduler`의 debounce/queue 메커니즘과 충돌하지 않도록 sequencing 필요

---

### 3.2 멀티레벨 커뮤니티 계층

**현재:** `detectCommunities()`가 Louvain 1회 실행 → level 0 플랫 커뮤니티.

**목표:** Louvain 반복 적용으로 level 0, 1, 2 계층적 커뮤니티 구조 생성.

**변경 파일:** `src/graph/community-detector.ts`, `src/graph/community-summarizer.ts`, `src/graph/indexing-runner.ts`

#### 구현 항목 (Must Have)

```
[Function] buildHierarchy(
    edges: CommunityEdge[],
    maxLevels = 3,
): CommunityHierarchy
```

- level 0: Louvain 1차 실행 (기존 `detectCommunities` 재사용)
- level 1: level 0의 각 커뮤니티를 super-node로 취급
  - super-node 간 엣지 가중치 = 두 커뮤니티 사이의 모든 크로스 엣지 가중치 합
  - Louvain 재실행 → level 1 커뮤니티
- level 2: level 1의 커뮤니티를 super-node로 → 동일 방식
- 반환:
  ```typescript
  interface CommunityHierarchy {
    levels: CommunityLevel[];  // level 0, 1, 2
    entityToCommunity: Map<string, CommunityPath>;
    // CommunityPath = { level0: number, level1?: number, level2?: number }
  }
  ```

```
[Modification] CommunitySummarizer.summarizeCommunities()
```

- `level` 인자 추가: 각 레벨의 커뮤니티 요약
- level 0: 기존과 동일 (entity/relation/claim 세부 정보 포함)
- level 1/2: 상위 레벨 요약 (더 추상적, 핵심 테마 중심)
- 프롬프트를 레벨에 따라 차별화:
  - level 0: "엔티티, 관계, 클레임의 세부 정보를 바탕으로 2-4문장 요약"
  - level 1: "여러 관련 커뮤니티를 통합한 상위 주제를 2-3문장으로 요약"

```
[Modification] GraphRagIndexingRunner.buildCommunities()
```

- 기존 `buildEdges` + `detectCommunities` → `buildHierarchy`로 대체
- 각 레벨별로 `summarizeCommunities` 호출
- `GraphCommunityRecord.level` 필드 설정 (이미 존재)
- `parentCommunityId` 연결

```
[Modification] GraphRagQueryEngine.queryGlobal()
```

- highest level 커뮤니티 `summaryVector` 우선 검색
- 필요 시 하위 레벨 drill-down (선택 사항, Phase 2.4에서 완성)

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 3레벨 이상 생성 | 실용적 이점 희박, LLM 호출 증가 |
| LLM 호출 폭증 | 커뮤니티 수가 기하급수적으로 증가하지 않도록 합산/축소 방식 사용 |
| 기존 community ID 포맷 변경 | 저장된 채팅 세션과의 backward compatibility 깨짐 |

#### 주의사항

- `GraphCommunityRecord`에 `parentCommunityId`는 이미 존재 → 별도 스키마 변경 불필요
- `summaryVector`는 각 레벨별로 별도 저장
- `level` 인덱스가 Dexie 스키마에 이미 있음 (`graphCommunities: '..., level, ...'`)
- level 0 커뮤니티는 기존 포맷과 완전 호환되어야 함

---

### 3.3 추출 품질 메트릭

**현재:** 추출 품질 측정 기능 없음. `settings-display.ts`에 기본 상태 표시만 있음.

**목표:** 엔티티/관계/클레임 통계, 타입 coverage, 신뢰도 분포, 거부율 등의 메트릭 수집.

**변경 파일:** `src/graph/metrics.ts`(신규), `src/graph/status.ts`

#### 구현 항목 (Must Have)

```
[Interface] GraphRagMetrics
```

```typescript
interface GraphRagMetrics {
  entityCount: number;
  relationCount: number;
  claimCount: number;
  evidenceCount: number;
  communityCount: number;
  entityTypeDistribution: Record<string, number>;    // typeId → count
  relationTypeDistribution: Record<string, number>;
  avgConfidence: {
    entity: number;
    relation: number;
    claim: number;
  };
  confidenceDistribution: {
    ranges: [0, 0.2, 0.4, 0.6, 0.8, 1];
    entityCounts: number[];
    relationCounts: number[];
    claimCounts: number[];
  };
  avgRelationsPerEntity: number;
  avgEvidencePerEntity: number;
  rejectedFactCount: number;
  rejectedRate: number;          // rejected / (accepted + rejected)
  staleFileCount: number;
  staleRate: number;             // stale / total
  schemaId: string;
  schemaVersion: number;
  lastExtractedAt: number | null;
  lastCommunityBuildAt: number | null;
}
```

```
[Function] calculateGraphRagMetrics(
    graphStore: KnowledgeGraphStore,
    vectorStore: VectorStore,
    ragConfig: RAGConfig,
): Promise<GraphRagMetrics>
```

- `graphStore.getEntities()` / `getRelations()` / `getClaims()` / `getEvidence()` / `getCommunities()`
- `getRejectedFacts()`, `getExtractionCacheRecords()`
- `status.ts`의 stale 계산 로직 활용

```
[Integration] GraphRagStatusSummary 확장
```

```typescript
interface GraphRagStatusSummary {
  // 기존 필드 유지
  metrics?: GraphRagMetrics;  // 신규 (optional, 계산 비용 고려)
}
```

- `computeAndEmitGraphRagStatus()`에서 metrics 함께 계산
- 상태 갱신 주기: 인덱싱 중 1초, 대기 중 30초

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 실시간 LLM 평가 | 비용/속도 문제. 수집된 통계만 활용 |
| 매 상태 갱신마다 모든 엔티티/관계 로드 | 30초 간격이면 OK. 더 짧은 주기는 캐싱 필요 |
| 대용량 배열 불변 복사 반복 | 메모리 오버헤드 |

---

### 3.4 다중 온톨로지 지원

**현재:** `DEFAULT_ONTOLOGY_SCHEMA`만 사용. `RAGConfig.ontologyEnabled` boolean만 있음.

**목표:** 사용자 정의 온톨로지 파일 로드/선택, 온톨로지별 인덱싱 및 검색.

**변경 파일:** `src/ontology/loader.ts`(신규), `src/ontology/schema.ts`, `src/settings.ts`

#### 구현 항목 (Must Have)

```
[File] src/ontology/loader.ts
```

```typescript
export function loadOntologySchemas(vault: Vault): OntologySchema[];
  // .superpower-inside/ontology/*.json 파일 스캔
  // 각 파일을 OntologySchema로 파싱 + validateOntologySchema() 검증
  // 검증 실패 파일은 건너뛰고 콘솔 경고

export function saveOntologySchema(vault: Vault, schema: OntologySchema): Promise<void>;
  // .superpower-inside/ontology/{schema.id}.json에 저장
  // 저장 전 validateOntologySchema() 실행

export function getDefaultOntologyPath(vault: Vault): string;
  // .superpower-inside/ontology/default.json
```

```
[Modification] RAGConfig (settings.ts)
```

```typescript
interface RAGConfig {
  // 기존 필드 유지
  ontologySchemaId: string;  // 신규, 기본값 'default'
}
```

```
[Modification] main.ts initRAG()
```

- `ragConfig.ontologySchemaId`에 해당하는 스키마를 `loader.loadOntologySchemas()`에서 찾음
- 없으면 `DEFAULT_ONTOLOGY_SCHEMA` 사용
- 온톨로지 ID/버전 변경 시 `extractionCache`의 `ontologySchemaId/ontologyVersion`으로 캐시 무효화

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 한 번에 여러 온톨로지로 동시 인덱싱 | 복잡도 급증. Phase 1 범위 밖 |
| 온톨로지 파일 검증 없이 로드 | schema-error 상태 유발 |
| 온톨로지 변경 후 자동 재인덱싱 | 사용자 확인 필요. 설정 UI에서 안내 |

#### 주의사항

- `GraphEntityRecord.ontologySchemaId`로 이미 네임스페이스 분리되어 있어 backend는 multi-ontology 대응 가능
- `GraphRagQueryEngine` 생성 시 `ontologySchema` 인자 전달 방식 유지
- 온톨로지 파일 예시 (`default.json`):

```json
{
  "id": "custom-bible",
  "name": "Custom Bible Ontology",
  "version": 1,
  "locale": "ko",
  "entityTypes": [...],
  "relationTypes": [...],
  "claimTypes": [...],
  "aliasRules": [...],
  "mergeRules": [...],
  "extractionGuidelines": ""
}
```

---

## 4. Phase 2: 검색/채팅 계층

### 4.1 자동 엔티티 감지

**현재:** `@entity:Name` 명시적 멘션만 처리. `MentionResolver.isEntity()`는 Set 기반 exact match.

**목표:** 사용자 질문 텍스트에서 엔티티명을 자동 fuzzy 매칭, 컨텍스트에 포함.

**변경 파일:** `src/chat/context.ts`, `src/graph/query-engine.ts`

#### 구현 항목 (Must Have)

```
[Function] autoDetectEntities(
    question: string,
    entities: GraphEntityRecord[],
    maxMatches = 5,
): GraphEntityRecord[]
```

매칭 로직:
1. 질문을 토큰화 (공백/조사 분리, 한글/영문)
2. 각 엔티티의 `canonicalName` + `aliases`와 매칭
3. 매칭 조건:
   - **exact match:** 질문 토큰 중 하나가 엔티티명과 일치 (대소문자 무시)
   - **partial match:** 질문 토큰이 엔티티명에 substring으로 포함
   - **normalized match:** `normalizeEntityName()` 적용 후 포함 관계
4. 매칭된 엔티티를 confidence 기준 정렬, 상위 `maxMatches`개 반환

```
[Modification] buildChatContext() in context.ts
```

- `options.autoDetectEntities` 플래그 (boolean, 기본 true)
- `options.graphRagEnabled && options.knowledgeGraphStore && options.autoDetectEntities`면 자동 감지 실행
- `QuestionAnalysis` 단계에서 실행 (기존 멘션 파싱 후, RAG 검색 전)
- 자동 감지된 엔티티 → `appendGraphEntityContext()`에 전달
- `ContextAttachment`에 `type: 'auto-entity'`, `label: '자동 감지 엔티티'` 추가
- `citations` 중복 방지: `@entity:Name`과 auto-detect가 같은 엔티티를 가리키면 하나만 포함

```
[New field] ChatConfig / ContextOptions
```

```typescript
interface ChatConfig {
  // 기존 필드 유지
  autoDetectEntities: boolean;  // 신규, 기본 true
}
```

```
[Modification] MentionResolver (선택 사항)
```

- 자동 감지는 `mention-parser`와 독립적 경로로 동작
- `@entity:` 접두사 방식은 명시적 멘션으로 유지
- `ContextAttachment.status`에 `'auto-detected'` 값 추가

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 매 질문마다 전체 엔티티 목록 IndexedDB 조회 | 메모리 캐시 도입 (entitiesById Map) |
| 오탐(false positive) 무분별 증가 | confidence 임계값(≥0.5), 타입 필터 도입 |
| 한국어 형태소 분석 라이브러리 의존 | 단순 문자열 매칭으로 충분 |

#### 주의사항

- `createAppMentionResolver()`는 이미 엔티티명 Set을 로드하지만 비동기 타이밍 이슈 존재
- `buildChatContext()` 내에서 `graphStore.getEntities()`를 동기적으로 await하여 사용
- `@entity:Name`과 auto-detect 중복 시 `citations` Map으로 ID 중복 체크

---

### 4.2 구조화된 그래프 컨텍스트 포맷

**현재:** `appendGraphEntityContext()`가 엔티티/관계를 단순 마크다운 리스트로 포맷.

**목표:** 관계 구조, 증거 출처, 타입 정보를 포함한 풍부한 구조화 포맷.

**변경 파일:** `src/chat/context.ts`

#### 구현 항목 (Must Have)

```
[Function] formatGraphContext(
    entities: GraphEntityRecord[],
    relations: GraphRelationRecord[],
    claims: GraphClaimRecord[],
    evidence: GraphEvidenceRecord[],
    maxEntities = 10,
    maxRelationsPerEntity = 5,
): string
```

출력 포맷:
```
=== Knowledge Graph Context ===

## Entities
- [person] 바울 (aka 사울, Paul)
  설명: 기독교 초기 지도자
  연결: collaborated_with → 바나바, authored → 로마서
  출처: Acts.md L120-135, Romans.md L1-7

## Relations
- 바울 --[collaborated_with]--> 바나바
  설명: 1차 전도여행 동행
  신뢰도: 0.92 | 출처: Acts.md L200-215

## Key Claims
- [factual_claim] 바울과 바나바는 1차 전도여행을 함께했다
  관련: 바울, 바나바
  입장: neutral
  신뢰도: 0.85
```

```
[Modification] systemPrompt 가이드 추가
```

```typescript
const GRAPH_CONTEXT_GUIDE =
  '지식 그래프 컨텍스트의 [type] 태그는 엔티티의 온톨로지 타입을 나타냅니다.\n' +
  '--[relation_type]-->는 엔티티 간의 관계입니다.\n' +
  '출처가 명시된 정보는 볼트 문서에서 직접 추출된 사실입니다.\n';
```

- `[Vault Context Rules]` 섹션에 추가

```
[Modification] appendGraphEntityContext()
```

- 기존 단순 리스트 → `formatGraphContext()` 호출로 대체
- 컨텍스트 예산(budget) 내에서 `maxEntities`, `maxRelations`, `maxClaims` 동적 조절

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| JSON raw dump | LLM이 이해하기 어려움 |
| 구조화 태그 없이 평문 | LLM이 그래프 구조를 무시할 가능성 |
| 컨텍스트 예산 무시 | 토큰 초과 위험. budget.trimToFit() 적용 |

---

### 4.3 `/graph` 채팅 명령어

**현재:** 없음.

**목표:** `/graph` 인라인 명령어로 엔티티/관계/커뮤니티 조회.

**변경 파일:** `src/chat/commands.ts`(신규), `src/chat/view.ts`

#### 구현 항목 (Must Have)

```
[File] src/chat/commands.ts
```

```typescript
interface ChatCommand {
  match: RegExp;
  handler: (
    args: string[],
    context: CommandContext,
  ) => Promise<CommandResult>;
}

interface CommandContext {
  graphStore: KnowledgeGraphStore;
  metrics: GraphRagMetrics | null;
}

interface CommandResult {
  type: 'markdown' | 'error';
  content: string;
}
```

서브커맨드:

| 명령어 | 예시 | 동작 |
|--------|------|------|
| `/graph <name>` | `/graph 바울` | 엔티티 fuzzy 검색 → 상세 정보 + 관계 + 증거 |
| `/graph path:<A>→<B>` | `/graph path:바울→베드로` | BFS 최단 경로 탐색 |
| `/graph stats` | `/graph stats` | `calculateGraphRagMetrics()` 결과 포맷팅 |
| `/graph community [id]` | `/graph community 3` | 커뮤니티 요약 조회 |
| `/graph help` | `/graph help` | 사용 가능한 서브커맨드 목록 |

```
[Implementation Detail] BFS 경로 탐색
```

```typescript
function findShortestPath(
    relations: GraphRelationRecord[],
    sourceEntityId: string,
    targetEntityId: string,
): GraphRelationRecord[][] | null;
```

- entity ID를 노드, relation을 무방향 엣지로 하는 그래프
- BFS로 최단 경로 탐색 (다중 경로 가능)
- 경로상의 각 relation + source/target entity 정보 포함

```
[Integration] ChatView.sendMessage()
```

- user input이 `/`로 시작하면 `parseCommand()` 호출
- 명령어면 LLM 호출 없이 명령어 처리 결과를 assistant message로 표시
- `ChatMessage.isCommand: boolean = true` 플래그 추가 (저장/로드 시 구분)
- 스트리밍 미사용, 즉시 결과 표시

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| `/` 로 시작하는 일반 메시지와 충돌 | `//graph` → 일반 텍스트, `/graph` → 명령어 |
| LLM 스트리밍 경로와 충돌 | 명령어는 별도 처리 경로로, LLM 호출 건너뜀 |
| 경로 탐색 시 방향성 무시 | relation은 방향이 있으므로 무방향 그래프로 처리 |

---

### 4.4 GraphRAG 검색 랭킹 개선

**현재:** `getRetrievalSourceBoost()`가 `graph-local`/`graph-global`에 0.68 고정 부스트.

**목표:** entity confidence, relation density, evidence freshness 기반 동적 점수.

**변경 파일:** `src/rag/query.ts`, `src/graph/query-engine.ts`

#### 구현 항목 (Must Have)

```
[Modification] GraphRagQueryEngine.queryLocal()
```

각 후보의 `sourceScore` 계산식:
```
sourceScore = 0.5 * matchScore
            + 0.2 * confidence
            + 0.2 * density
            + 0.1 * freshness
```

| 요소 | 계산 |
|------|------|
| `matchScore` | 질문-엔티티명 매칭 여부 (1.0 또는 0.5) |
| `confidence` | 엔티티의 `confidence` 값 (0~1) |
| `density` | `min(1, entityRelationsCount / avgRelationsCount)` |
| `freshness` | `min(1, (now - maxEvidenceUpdatedAt) / (7 * 86400000))` |

```
[Modification] query.ts getRetrievalSourceBoost()
```

```typescript
function getRetrievalSourceBoost(
  sourceScores: Partial<Record<RetrievalCandidateSource, number>>,
): number {
  const graphScore = Math.max(
    sourceScores['graph-local'] ?? 0,
    sourceScores['graph-global'] ?? 0,
    sourceScores.evidence ?? 0,
  );
  if (graphScore > 0) {
    // 기존: Math.max(0.68, graphScore) → 변경: Math.max(0.5, graphScore)
    return Math.max(0.5, Math.min(0.95, graphScore));
  }
  return Math.max(sourceScores.structural ?? 0, sourceScores.ann ?? 0);
}
```

- 최소 부스트 0.5 (기존 0.68보다 낮춰서 일반 검색 결과와의 균형 개선)
- 최대 부스트 0.95 (과도한 graph bias 방지)

```
[Modification] query.ts isRelevantResult()
```

```typescript
function isRelevantResult(
  result: QueryResult,
  threshold: number,
  hasBm25: boolean,
  hasGraphSource?: boolean,  // 신규
): boolean {
  if (result.combinedScore < threshold) return false;
  if (!hasBm25) return !hasGraphSource || result.vectorScore >= threshold - 0.1;
  if (result.bm25Score > 0 && result.keywordMatches > 0) return true;
  // graph-source 결과는 더 관대한 임계값 적용
  if (hasGraphSource) return result.vectorScore >= Math.max(0.5, threshold);
  return result.vectorScore >= Math.max(0.62, threshold + 0.08);
}
```

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 기존 비그래프 검색(vector/bm25/structural) 점수 체계 훼손 | 각 Provider는 독립적 |
| 너무 복잡한 점수 계산식 | 유지보수 어려움. 4개 요소로 제한 |

---

## 5. Phase 3: UI/시각화 계층

### 5.1 엔티티-관계 그래프 시각화

**현재:** `GraphRagView`에 entities/relations/evidence/communities/rejected 플랫 리스트 탭.

**목표:** D3.js force-directed graph 기반 대화형 그래프 뷰 탭 추가.

**변경 파일:** `src/graph/view.ts`, `src/graph/graph-renderer.ts`(신규), `package.json`, `styles.css`

#### 의존성 추가

```
npm install d3-force d3-selection d3-zoom d3-drag
npm install --save-dev @types/d3-force @types/d3-selection @types/d3-zoom @types/d3-drag
```

예상 번들 크기: d3-force 10KB + d3-selection 8KB + d3-zoom 5KB + d3-drag 3KB ≈ 26KB (gzip ≈ 8KB)

#### 구현 항목 (Must Have)

```
[File] src/graph/graph-renderer.ts
```

```typescript
class GraphRenderer {
  constructor(containerEl: HTMLElement);
  
  render(
    entities: GraphEntityRecord[],
    relations: GraphRelationRecord[],
    options?: {
      highlightEntityId?: string;
      communityColors?: Map<string, string>;
    },
  ): void;
  
  destroy(): void;
  updateData(entities: GraphEntityRecord[], relations: GraphRelationRecord[]): void;
  focusEntity(entityId: string): void;
  getSelectedEntityId(): string | null;
  
  // Events
  onEntityClick: ((entityId: string) => void) | null;
  onEntityHover: ((entityId: string | null) => void) | null;
}
```

**렌더링 상세:**

- **SVG 기반:** `createElementNS('http://www.w3.org/2000/svg', 'svg')` 사용
- **노드:** 원형 (반경 8px), 온톨로지 타입별 색상 (`entityTypeColor` 함수 재사용)
  - 텍스트 라벨 (엔티티명, 12px)
  - 호버 시 확대/툴팁
  - 클릭 시 `onEntityClick` 콜백
- **엣지:** 선 + 화살표 (`marker-end`)
  - relationTypeId별 색상/굵기
  - 호버 시 relation type label 표시
- **상호작용:**
  - `d3-drag`: 노드 드래그 (force 재시작)
  - `d3-zoom`: 줌/팬 (scaleExtent: [0.1, 4])
  - `hover`: 노드/엣지 하이라이트, 툴팁
  - `click`: 엔티티 detail 연동
- **Force parameters:**
  - `forceLink`: distance=120, strength=0.3
  - `forceManyBody`: strength=-300
  - `forceCenter`: x=50%, y=50%
  - `forceCollide`: radius=20
- **성능:**
  - maxNodes=500 표시 제한 (초과 시 search/filter 필요 안내)
  - 200+ 노드에서 simulation quality 저하 (alpha decay 증가)

```
[Modification] GraphRagView (view.ts)
```

- 탭 배열에 `'graph'` 추가: `['entities', 'relations', 'evidence', 'graph', 'communities', 'rejected']`
- `'graph'` 탭 선택 시 `GraphRenderer` 생성
- `renderGraph()` 메서드:
  - 현재 검색/필터 조건 적용된 엔티티/관계 전달
  - `GraphRenderer.onEntityClick` → `navigateToEntity(entity)` → entity detail로 전환
- 엔티티 detail에 "관계 그래프에서 보기" 버튼 추가
  - 클릭 → `activeTab = 'graph'`, `graphRenderer.focusEntity(entityId)`

```
[Modification] styles.css
```

```css
.superpower-inside-graph-view-graph {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.superpower-inside-graph-view-graph svg {
  width: 100%;
  height: 100%;
}

.superpower-inside-graph-view-graph .node circle {
  cursor: pointer;
  stroke: var(--background-modifier-border);
  stroke-width: 1.5px;
  transition: r 0.1s ease;
}

.superpower-inside-graph-view-graph .node:hover circle {
  stroke-width: 3px;
}

.superpower-inside-graph-view-graph .link {
  stroke: var(--background-modifier-border);
  stroke-opacity: 0.6;
}

.superpower-inside-graph-view-graph .link:hover {
  stroke-opacity: 1;
}

.superpower-inside-graph-view-graph .node-label {
  font-size: 11px;
  pointer-events: none;
  fill: var(--text-muted);
}
```

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| `d3` 전체 번들 import | `import { forceSimulation, forceLink, ... } from 'd3-force'` 형태로 선택 import |
| 1000개 이상 노드 force simulation | max 500 노드 제한. 초과 시 검색/필터 권장 메시지 |
| `innerHTML`으로 SVG 삽입 | XSS 위험. `createElementNS` + `appendChild` 사용 |
| `GraphRagView`에 렌더러 로직 직접 구현 | `graph-renderer.ts`로 완전 분리 |

#### esbuild 설정 참고

`esbuild.config.mjs`에서 D3.js 모듈의 tree-shaking을 위해:

```javascript
// esbuild는 기본적으로 ESM tree-shaking 지원
// d3-force, d3-selection 등 개별 패키지는 side-effect-free 이므로
// import { forceSimulation } from 'd3-force' 형태로 사용하면 자동 tree-shaking
```

---

### 5.2 커뮤니티 맵

**현재:** 커뮤니티를 플랫 리스트로 표시 (`renderCommunities()`).

**목표:** 커뮤니티 간 관계를 시각화하는 카드 맵 뷰.

**변경 파일:** `src/graph/view.ts`

#### 구현 항목 (Must Have)

```
[Modification] GraphRagView.renderCommunities()
```

- 탭/토글 버튼: "리스트 뷰" ↔ "맵 뷰"
- 맵 뷰:
  - flex-wrap 그리드 레이아웃
  - 각 커뮤니티 = 카드
  - 카드 내용:
    - 타이틀 (Community N)
    - 요약 (2줄, `truncate(summary, 120)`)
    - 엔티티 수, 관계 수, 클레임 수
    - 교차 커뮤니티 관계 수 (다른 커뮤니티와 연결된 relation 수)
  - 카드 색상: 레벨별 색상 구분 (level 0: 파랑, level 1: 초록, level 2: 주황)
  - 클릭 → 커뮤니티 상세 모달/패널
    - 포함된 엔티티 목록
    - 요약 전문
    - 교차 커뮤니티 관계 목록
- 레벨별 탭 (level 0, 1, 2) — Phase 1.2 완료 후 활성화

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 복잡한 레이아웃 엔진 | CSS flex/grid로 충분 |
| 50개 이상 카드의 무분별 표시 | 페이지네이션 (20개/page) 또는 레벨별 분리 |

---

### 5.3 온톨로지 편집기

**현재:** 코드 내 `DEFAULT_ONTOLOGY_SCHEMA`에 하드코딩.

**목표:** GUI 온톨로지 편집기.

**변경 파일:** `src/ontology/editor.ts`(신규), `src/settings.ts`

#### 구현 항목 (Must Have)

```
[File] src/ontology/editor.ts
```

```typescript
class OntologyEditor {
  constructor(
    containerEl: HTMLElement,
    schema: OntologySchema,
    onSave: (schema: OntologySchema) => Promise<void>,
  );
  
  render(): void;
  destroy(): void;
}
```

렌더링 섹션:

1. **온톨로지 메타**
   - id (읽기 전용), name (text input), version (number input)
   - description (textarea), locale (select: ko/en/mixed)

2. **엔티티 타입 목록**
   - 테이블: id | label | description | examples | actions
   - 각 행 클릭 시 인라인 편집
   - "추가" 버튼 → 새 행 삽입
   - "삭제" 버튼 (확인 dialog)
   - 부모 타입 선택 (다른 entityType.id 참조)

3. **관계 타입 목록**
   - 테이블: id | label | sourceTypes | targetTypes | symmetric | actions
   - sourceTypeIds/targetTypeIds: multi-select 체크박스
   - inverseRelationTypeId: relation type select
   - symmetric/transitive: toggle

4. **클레임 타입 목록**
   - 테이블: id | label | description | actions

5. **저장 버튼**
   - `validateOntologySchema()` 실행 → 오류 목록 표시
   - 통과 시 `onSave()` 호출
   - 저장 후 "GraphRAG 재인덱싱이 필요할 수 있습니다" 안내

```
[Modification] SuperpowerInsideSettingTab
```

- RAG 설정 섹션에 "온톨로지 편집" 버튼
- 버튼 클릭 → 모달 또는 설정 탭 내 인라인 편집기 열기
- 현재 선택된 온톨로지 스키마 전달
- 저장 시 `loader.saveOntologySchema()` 호출 → `.superpower-inside/ontology/{id}.json` 파일 저장
- 재인덱싱 필요 안내 + "지금 재인덱싱" 버튼 (선택 사항)

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 너무 복잡한 폼 UI | 기본 CRUD + validation으로 범위 제한 |
| 저장 후 자동 재인덱싱 | 사용자 확인 필요 |

---

### 5.4 GraphRAG 설정 UI 개선

**현재:** 기본 설정 필드만 있음.

**목표:** 상태 대시보드, 인덱싱 비용 추정, 진행률 표시 개선.

**변경 파일:** `src/settings.ts`, `src/graph/status.ts`

#### 구현 항목 (Must Have)

```
[UI Section] GraphRAG 상태 대시보드
```

설정 탭 RAG 섹션 하단에 추가:

```
┌─ GraphRAG 상태 ─────────────────────────────────┐
│  상태 배지: ● 준비됨                            │
│                                                  │
│  ┌──────┬─────┐  ┌──────┬──────┐               │
│  │엔티티│ 42개│  │관계   │156개 │               │
│  ├──────┼─────┤  ├──────┼──────┤               │
│  │클레임│ 89개│  │증거   │210개 │               │
│  ├──────┼─────┤  ├──────┼──────┤               │
│  │커뮤니티│ 5개│  │실패   │  2개 │               │
│  ├──────┼─────┤  ├──────┼──────┤               │
│  │동기화필요│12개│  │평균신뢰│ 0.87 │               │
│  └──────┴─────┘  └──────┴──────┘               │
│                                                  │
│  인덱싱 비용 추정: 50파일 × 12청크 = 600회 LLM 호출│
│  ─────────────────────────────────────────────── │
│  [시작] [이어서] [취소]  [커뮤니티 빌드]         │
└──────────────────────────────────────────────────┘
```

- `getGraphRagStatusPresentation()`의 `tone`에 따라 배지 색상:
  - `success`: 초록
  - `warning`: 노랑/주황
  - `danger`: 빨강
  - `neutral`: 회색
- 통계는 `GraphRagMetrics` 데이터 활용
- 인덱싱 비용은 `estimateGraphRagIndexingCost()` 활용
- 버튼 상태는 `getGraphRagControlState()` 활용

```
[UI Section] 인덱싱 진행률
```

- `GraphRagView.showProgress()` 개선:
  - ETA 계산: `(elapsed / processedFiles) * remainingFiles`
  - "12/50 파일 처리 (24%) — 예상 남은 시간: 45초"

```
[Modification] main.ts computeAndEmitGraphRagStatus()
```

- `refreshBus`를 통해 설정 UI에 상태 업데이트 emit
- 업데이트 주기: 인덱싱 중 1초, 대기 중 30초

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| 슬라이더 입력 | 프로젝트 컨벤션 위반. 숫자 텍스트 입력 유지 |
| 실시간 차트/그래프 | 설정 탭에 과도한 시각화. 텍스트 통계로 충분 |

---

### 5.5 엔티티 브라우징 UX 개선

**현재:** 플랫 리스트 + 검색, detail view는 단일 엔티티 정보만 표시.

**목표:** 타입별 브라우징, 연관 엔티티 네비게이션, 관계 그래프와 연동.

**변경 파일:** `src/graph/view.ts`

#### 구현 항목 (Must Have)

```
[Modification] GraphRagView.renderEntities()
```

- 타입별 아코디언 (현재는 타입별 그룹핑만, 접기/펼치기 기능 추가)
- 타입 헤더 클릭 → 접기/펼치기
- 타입별 엔티티 수 표시: `"Person (12)"`
- 처음 로드 시 엔티티 수가 가장 많은 타입만 펼쳐짐

```
[Modification] GraphRagView.renderEntityDetail()
```

- "연관 엔티티 탐색" 섹션 추가:
  - 현재 엔티티와 1-hop 관계로 연결된 모든 엔티티 목록
  - 각 연관 엔티티: [type] name — relation_type → [type] connected_name
  - 연관 엔티티 클릭 → detail view 전환
- 브레드크럼: `Home > 바울 > 바나바` (이전 엔티티로 돌아가기)
- "관계 그래프에서 보기" 버튼:
  - 그래프 탭이 활성화되어 있어야 함
  - 클릭 시 graph tab 전환 + focusEntity(entityId)

#### 피해야 할 것

| 금지 | 이유 |
|------|------|
| `GraphRagView`에 모든 로직 추가 | 이미 698줄. 아코디언/네비게이션 상태는 별도 클래스로 분리 고려 |

---

## 6. 전체 Anti-Patterns & 주의사항

### 6.1 금지 패턴

| 패턴 | 이유 |
|------|------|
| `src/graph/view.ts`에 모든 시각화 로직 추가 | 이미 698줄. `graph-renderer.ts` 등 별도 파일로 분리 |
| D3.js 전체 번들 | tree-shaking 필수. 개별 패키지만 import |
| `@entity` 명시 멘션과 auto-detect 중복 citation | `citations` Map으로 ID 중복 체크 |
| 파일 삭제 시 엔티티 hard-delete | 다른 파일의 증거가 있을 수 있음 |
| 온톨로지/모델 변경 후 자동 재인덱싱 | 사용자 확인 필요 |
| 3레벨 이상 커뮤니티 계층 | 실용적 이점 희박 |
| 매 질문마다 전체 엔티티 목록 IndexedDB 조회 | 메모리 캐시 도입 |
| `as any`, `@ts-ignore`, `@ts-expect-error` | TS strict 정책 위반 |
| 런타임 `process.env` 의존 | Obsidian 브라우저 런타임에 보장되지 않음 |

### 6.2 반드시 지켜야 할 사항

| 항목 | 상세 |
|------|------|
| **TypeScript strict** | 모든 신규 파일은 `strict`, `noImplicitAny`, `noUnusedLocals` 준수 |
| **테스트** | 모든 신규 함수에 Vitest 테스트 추가 (store, query, extraction 등 pure function 위주) |
| **검증 순서** | `npm run lint` → `npm run typecheck` → `npm run test` |
| **IndexedDB 스키마** | 변경 시 Dexie 버전 migration (현재 `version(1)`) |
| **ContextAttachment** | 신규 `type`/`status` 값은 `types.ts`에 정의 후 `i18n.ts`에 키 추가 |
| **i18n** | 모든 UI 텍스트는 `i18n.ts`에 `ko`/`en` 키 추가 (누락 금지) |
| **의존성** | 새 NPM 패키지는 `package-lock.json`과 함께 커밋 |
| **데드라인** | `GraphRagCandidateProvider.deadlineMs=180` 변경 시 성능 테스트 필수 |
| **번들 크기** | D3.js 선택 import 시 esbuild 설정에서 불필요 모듈 제거 확인 |
| **CSS 프리픽스** | 모든 신규 CSS 클래스는 `superpower-inside-` 프리픽스 사용 |

### 6.3 성능 고려사항

| 시나리오 | 예상 부하 | 대책 |
|----------|-----------|------|
| 엔티티 1000개 그래프 렌더링 | D3 force simulation: 500ms | maxNodes=500 제한, 필터 권장 |
| 증분 인덱싱 (파일 1개 변경) | LLM 1-5회 호출 | 캐시 hit 시 skip |
| 멀티레벨 커뮤니티 재빌드 | Level 0: 기존과 동일, Level 1/2: LLM 호출 증가 | maxLevels=3 제한 |
| 자동 엔티티 감지 | 질문당 0.1-1ms (Set lookup) | 메모리 캐시로 충분 |
| `/graph stats` | IndexedDB 6개 테이블 조회: 2-10ms | 캐시 재사용 |
| 설정 UI 상태 갱신 | 30초 간격: 10-50ms | 부하 낮음 |

---

## 7. 테스트 전략

### 7.1 신규 테스트 파일

| 파일 | 테스트 대상 | 예상 테스트 수 |
|------|-----------|---------------|
| `src/graph/metrics.test.ts` | `calculateGraphRagMetrics` | 5-7 |
| `src/ontology/loader.test.ts` | `loadOntologySchemas`, `validateOntologySchema` | 5 |
| `src/ontology/editor.test.ts` | `OntologyEditor` 렌더링 (DOM 기반) | 3-5 |
| `src/chat/commands.test.ts` | 명령어 파싱, 서브커맨드 라우팅 | 8-10 |
| `src/graph/graph-renderer.test.ts` | `GraphRenderer` 렌더링 (SVG/DOM) | 3-5 |
| `src/chat/context.test.ts` | `autoDetectEntities`, `formatGraphContext` | 5-8 |

### 7.2 기존 테스트 확장

| 파일 | 추가 테스트 |
|------|------------|
| `src/graph/query-engine.test.ts` | `queryLocal` 점수 계산 검증, `queryGlobal` 멀티레벨 |
| `src/graph/indexing-runner.test.ts` | `incrementalRun`, `partialRebuildCommunities` |
| `src/graph/community-detector.test.ts` | `buildHierarchy` |
| `src/rag/query.test.ts` | `getRetrievalSourceBoost` 신규 점수 로직 |

### 7.3 테스트 우선순위

1. **Pure function:** `autoDetectEntities`, `formatGraphContext`, `findShortestPath`, `calculateGraphRagMetrics` — 반드시 Vitest 테스트
2. **Store interaction:** `incrementalRun`, `buildHierarchy` — InMemory store로 테스트
3. **DOM 렌더링:** `GraphRenderer`, `OntologyEditor` — 선택적 (수동 QA로 대체 가능)
4. **통합:** 증분 인덱싱 → 커뮤니티 재요약 → 검색 흐름 — `.test-vault`에서 수동 QA

---

## 8. 릴리스 계획

### 8.1 릴리스 단위

| 릴리스 | 포함 | 예상 시점 |
|--------|------|-----------|
| **v1.1.0** | Phase 1 완료 (증분 인덱싱 + 멀티레벨 커뮤니티 + 품질 메트릭 + 온톨로지 로더) | TBD |
| **v1.2.0** | Phase 2 완료 (자동 엔티티 감지 + 구조화 포맷 + /graph 명령어 + 랭킹 개선) | TBD |
| **v1.3.0** | Phase 3 완료 (그래프 시각화 + 커뮤니티 맵 + 온톨로지 편집기 + 설정 UI) | TBD |

### 8.2 각 릴리스 검증 항목

**v1.1.0**
- [ ] 파일 변경 시 GraphRAG 증분 인덱싱이 올바르게 동작하는가
- [ ] 멀티레벨 커뮤니티가 생성되고 쿼리에 활용되는가
- [ ] GraphRagMetrics가 올바르게 계산되는가
- [ ] 사용자 정의 온톨로지 로드/선택이 가능한가
- [ ] 기존 `@entity` 멘션과 RAG 검색이 정상 동작하는가 (회귀 테스트)
- [ ] `npm run lint`, `npm run typecheck`, `npm run test` 통과

**v1.2.0**
- [ ] 자동 엔티티 감지가 질문에 포함된 엔티티를 올바르게 찾는가
- [ ] 구조화된 그래프 컨텍스트가 system prompt에 올바르게 포함되는가
- [ ] `/graph` 명령어가 올바르게 동작하는가 (stats/path/entity/community/help)
- [ ] 검색 랭킹 개선으로 관련성 높은 결과가 상위에 오는가
- [ ] 기존 채팅/멘션 기능 회귀 없음

**v1.3.0**
- [ ] force-directed 그래프가 올바르게 렌더링되는가
- [ ] 커뮤니티 맵이 올바르게 표시되는가
- [ ] 온톨로지 편집기로 저장한 스키마가 로드되는가
- [ ] 설정 UI 대시보드가 올바르게 표시되는가
- [ ] 엔티티 타입 아코디언/연관 탐색이 올바르게 동작하는가
- [ ] 플러그인 번들 크기 가이드라인 이내 (`main.js` < 2MB)
