---
id: deterministic-core
type: module-design
status: draft
title: 결정적 계산과 WASM 계약
parent: superpower-architecture
references: [vault-evidence, superpower-architecture, retrieval-index]
---

# 결정적 계산과 WASM 계약

## 책임과 의도

검색·토큰화·정규화·청킹·랭킹·근거 구절 검증·집계와 결정적 계획을 입력에 대한 계산으로 수행한다. DOM·파일·네트워크·프로세스·자격증명 I/O를 소유하지 않는다. 선택 모델이나 볼트의 특정 문서·질의·정답을 계산 규칙으로 하드코딩하지 않는다.

TypeScript와의 경계는 `src/rag/rust-core.ts`의 입출력 매핑이며 WASM wire 형식·범위·타입 검증을 유지한다. 기본 발견·집계의 실행 횟수 목표와 현 구현의 차이는 `vault-evidence`가 소유한다.

공식 제공자의 한도 응답 정규화·최소 잔여 창 선택과 전역 조회 간격의 정상 입력 기본값·범위 제한은 `provider_quota.rs`의 `plan_provider_quota_json`이 소유한다. 창은 실제 응답에 존재하는 가변 목록이며 요금제 이름에 따른 고정 창·미제공의 0/100% 대체를 만들지 않는다. 요약의 표시 기간 단위도 반환된 초가 정확히 나누어지는 주·일·시간·분만 계산하며, 실제 초가 없으면 기간 길이를 만들지 않는다. 제공자 인증·endpoint·주기 수명과 결제 정책의 소유자는 `provider-boundary`다.

## 검색 비교와 원문 주소

검색 토큰·질의·비교용 문자열은 NFKC로 정규화하고 대소문자 비교 규칙을 일치시킨다. 이는 저장 원문·추출·hash·인용을 호환 문자로 다시 쓰는 지시가 아니다. 정규화로 길이가 바뀐 일치와 하이라이트는 원문의 byte·UTF-16 위치로 대응시키고 절대 행·원문 인용 검증을 유지한다. native auto/phrase의 근거 구간 원장도 같은 검색 정규화를 사용하며 명시적인 exact/word 모드의 기존 의미는 바꾸지 않는다.

토큰 규칙이 바뀐 nonempty 색인에 일부 새 문서를 추가·교체·제거했다고 전체 색인을 새 버전으로 표시하지 않는다. 빈 색인·명시적 전체 재구성만 새 토큰 계약을 채택할 수 있다. 기존 직렬화의 버전·문서와 제한 읽기를 보존하며 버전 불일치를 데이터 삭제·벡터 재생성 권한으로 해석하지 않는다.

BM25 정확 집계는 토큰 위치와 구문을 세며 원문 부분문자열 집계와 다른 단위다. `LiteralSourceScanner`는 LF로 나눈 행 전체에 NFKC→Unicode lowercase만 적용한 needle별 비중첩 부분 일치를 소유한다. CR·공백·구두점을 제거하거나 행을 가로질러 일치시키지 않는다. 같은 원문 범위로 확장된 두 발생도 합치지 않으며 고유 문서·일치 원문 행·발생을 별도로 센다. 반환 주소는 원문 전체 byte/UTF-16 exclusive 범위·1기반 행과 행 내부 정규화 UTF-8 범위다. 추출 구간의 0기반 inclusive 좌표는 원장 index로만 연결하며 reference 자체는 verified 인용이 아니다.

scanner는 한 원문·한 정규화 행·한 출력 페이지만 유지한다. 순서 있는 원문 블록의 실제 hash8·길이·charge를 seal한 뒤에만 결과를 배출하고, 페이지에 넣지 못한 발생의 cursor를 소비하지 않는다. `LiteralInventoryTotals`는 완전한 source summary만 UTF-16 경로 순서·중복·needle identity·expected source 수·안전 정수 overflow를 검사해 합산한다. 누락·부분·미완료·한도 실패는 성공 0이나 BM25 숫자로 대체하지 않는다. needle 1..128(각 UTF-16 4096·합 65536), header 1MiB, summary 16MiB, 페이지 1..256건·1..1MiB를 보정 없이 검증한다. 같은 일치 조건의 발견·집계 대조와 남은 검증 상태는 `engineering-contract`가 소유한다.

BM25의 inverted·위치 posting은 같은 문서 식별자 문자열 할당을 공유해 긴 식별자가 posting 수만큼 중복 상주하지 않게 한다. 이 내부 표현은 삽입·교체·삭제와 legacy/compact 복원에 동일하게 적용하며 metadata·문자열 값 정렬·점수·위치·기존 JSON 형식은 보존한다. 식별자 중복 절감은 전체 색인·JSON peak·RSS의 전역 메모리 상한을 보장하지 않는다.

## 실패·생성물 경계

요구 계약은 WASM 초기화·wire 실패를 TypeScript 계산으로 대신하지 않고 기존 오류·빈 결과·비활성 상태로 드러내는 것이다. indexed-evidence wrapper는 실패 시 null을 반환한다.

현재 차이: `rankTopKPairsRust`는 WASM 초기화 실패 시 TypeScript cosine·정렬로 대체하지 않고 null을 반환하며, `src/rag/store.ts`의 호출부는 이를 빈 결과로 처리한다(`src/rag/rust-core-unavailable.test.ts`). 이번 보강으로 검색 선택·다양성 계획, 벡터 저장소 add·replace·remove·stats·lookup 계획, RAG 상태 계산, pending 파일 계획의 TypeScript 계산 fallback도 제거했다. 각 계획은 WASM 실패 시 null을 반환하고, 저장소 쓰기 계획 실패는 쓰기를 중단하며 조회·통계는 빈 결과로 닫는다. `planNativeToolCompatibilityFallbackRust`·`planVaultLinkFallbackIndexRust`는 이름과 달리 Rust wire wrapper이며 TypeScript 계산 대체가 아니다. 이 명세가 나열하던 TS 계산 fallback은 제거됐다.

다만 `src/utils/rag-exclude-validation.ts`의 제외 경로·확장자 검증·정규화와 `src/chat/mcp-tools.ts`의 MCP 도구 인자 파싱·결과 정규화·빈 결과 판정(`parseToolArguments`·`normalizeToolResult`·`isMcpToolResultEmpty`)은 Rust를 먼저 사용하면서 실패 시 TypeScript 계산으로 닫는 경로가 남아 있다. 반면 같은 파일의 `isRecommendableExcludeExtension`은 Rust 실패 시 추천 불가(false)로 닫으므로 TS 재구현이 없다. 앞의 두 경로는 위 실패 계약과 아직 일치하지 않으므로, WASM을 사용할 수 없을 때 설정 검증과 도구 실행이 TS 결과로 계속 동작한다. 제거 전까지 이 차이를 완료로 해석하지 않는다. 같은 파일의 `classifyMcpToolError`는 Rust 분류가 실패하면 원문을 그대로 반환할 뿐 분류 계산을 TS로 재구현하지 않으므로 이 목록에서 제외한다. 검색·agent 리팩터링으로 TS 호출자가 사라진 wire export 10개는 glue에 남아 있으나, 이들의 입출력 매핑·타입 검증은 현재 대상이 아니다.

한도 정규화·요약·간격 wrapper는 WASM 초기화·wire 검증 실패에서 null을 반환한다. 호스트는 간격의 null을 기본 30초로 재계산해 사용자 설정에 저장하지 않는다. 로드·저장은 오류로 닫고, 이미 적용된 간격과 타이머를 보존한다. 정상적인 미설정 입력의 기본 30초와 정수 제한은 Rust의 성공 결과로만 얻는다.

BM25 worker의 치명적인 WebAssembly.RuntimeError 뒤에는 같은 instance로 스냅샷 대체 생성·free·재초기화를 계속하지 않는다. 최초 trap을 보존하고 이후 요청도 추가 WASM 호출 없이 실패로 정착하며, 정상적인 손상 snapshot의 기존 원문 복원과 치명적 trap은 구분한다. 새 계산 instance의 수명·원문 보존·진단 게시 경계는 `retrieval-index`가 소유한다.

WASM glue·base64는 수동 편집하지 않고 `npm run wasm:build`로 같은 소스 상태에서 `.local/generated/`에 생성한다. 컴파일·bindgen 중간물은 `engineering-contract`의 저장소 생성물 경계를 따른다. build/dev의 선행 WASM 빌드와 저장 형식의 legacy load·round-trip을 유지한다. PDF worker의 추출·페이지 매핑 예외는 `superpower-architecture`를 따른다.

## 자동 복구 계획

자동 batch 계획은 pending 전체 범위의 작은 corpus/vector partial scalar와 알려진 현재 hash·source 사건 무효화를 받아 eligible/deferred·한 기회의 bounded batch와 각각의 계수를 반환한다. corpus 행이 있으면 오래된 vector partial로 complete·legacy·불일치 corpus를 가리지 않는다. partial은 정확한 source completeness 상태이며 broader incomplete를 대신 쓰지 않는다. 거대한 source metadata나 원문을 이 계획에 보내지 않으며 I/O·재시도·내구 debt 수명은 `retrieval-index`가 소유한다.

source mtime은 유한 비음수 실수로 소수를 보존하고 fingerprint에도 반영한다. byte·문서·index·계수는 안전 정수다. 낯선 필드·희소/중복·잘못된 scalar를 거절하며 batch tie는 UTF-16 경로 순서다. 호스트 wrapper는 pending=actionable+deferred와 서로 겹치지 않는 전체 index 분할·batch 부분집합을 검증한다. 새 필수 분할/계수가 없는 구 생성물은 null로 닫고 TS 판단으로 대체하지 않는다.

## 로컬 자원 admission

`plan_local_rag_admission_json`은 호스트가 관측한 실제 backend·물리 작업 수·foreground 수요·inference 표본과 공유 source charge를 받아 다음 batch 및 source 준비 허용 여부만 계산한다. I/O·timer·메모리 수집과 전송 큐는 `provider-boundary`·`retrieval-index`가 소유한다. 미지원·오래된·손상 표본을 최적화 근거로 쓰지 않으며 기본 1행에서 건강 표본 뒤 한 단계 시험하고 실제 처리율이 5% 넘게 개선된 경우만 채택한다. foreground·lag·duration·메모리 압력과 backend 변화는 최적화를 제한한다.

상태는 이전 허용 상한도 기억하여 현재 batch보다 새 상한이 커도 **모든 상한 축소**에서 1행·빈 건강/시험 이력으로 되돌린다. 이전 상한 없는 손상 상태를 보정하지 않고 거절하며 이 이력은 영속 저장하지 않는다. wrapper 실패는 null이고 TS의 별도 admission 계산으로 대체하지 않는다. 이 결정적 판정은 실제 앱의 처리량이나 hardware 활용 보증이 아니다.

## Pipeline ETA

ETA의 선택적 pipeline 입력은 실제 성공 window wall과 로컬 physical miss 관측, 처리 종료 원장, 명시적 lifecycle을 받는다. 주 추정은 잔여 논리량에 window wall 처리율을 적용하고 마지막 실제 관측 뒤의 경과를 반영한다. 같은 backend의 fresh physical 처리율과 완전 귀속 비율로 얻는 추론 성분은 설명값이며 pipeline 추정에 더하지 않는다. 기존 recent/가중·교정·신뢰도 도구를 재사용하지만 통계적 정확성을 보장하지 않는다.

전체 ETA·pipeline 부분 추정·물리 설명값과 pipeline 신뢰도를 따로 반환한다. 미관측 최종 DB proof·manifest/cutover tail은 0으로 만들지 않으며 전체 남은 시간·완료 시각·구간은 null이다. 진행 없이 부분 예측 시간을 소진하면 stalled로 닫는다. known 0건·모든 파일 처리·정상 return은 완료 증명이 아니다. 호스트의 명시적 proof-complete 입력도 실패/부분 0, 성공/processed 파일과 예상 청크 원장의 전체 일치, 확정 planned 원장의 전체 일치를 요구한다. 미확정 planned 총량은 확정 값으로 강제하지 않는다.

시각은 같은 job의 유한 비음수 monotonic 실수이며 소수를 정수화하지 않는다. 수량은 안전 정수로 검사한다. 존재하는 pipeline의 누락/잘못된 필드·future/겹친 window·backend 모순·희소 배열은 거절하고 표본 배열은 각각 64개로 제한한다. legacy 비완료 계산 호환은 유지하되 count-only complete나 v1 논리 속도를 새 관측으로 승격하지 않는다. wrapper는 필수 네 출력 필드가 없는 구 생성물도 null로 닫고 TS 대체 계산을 하지 않는다. 관측·원장·UI 게시의 소유자는 `retrieval-index`다.

`plan_rag_runtime_work_eta_json`은 현재 단계의 유한 소수 monotonic 시각·nullable 안전 정수 수량·최대 64개 실제 진척 표본으로 경과·최근 진척 나이·처리율·남은 시간·신뢰도·사유를 반환한다. heartbeat는 새 표본이 아니며 단계/단위·처리 수 감소는 관측 수명을 나눈다. 총량 미상·표본 부족·정체는 남은 시간을 null로 남기고, 계산 가능한 초기 표본은 low 단계 추정을 허용한다. 비용이 서로 다른 원자 steps는 처리율로 외삽하지 않는다. processed=total도 실제 최종 await 정착 전에는 ETA 0이나 완료가 아닌 awaiting-settlement다. 이 결과를 전체 작업 ETA로 승격하거나 TS에서 대체 계산하지 않는다.

## 원문 출처 wire

`source_segment_chunks.rs`의 구간 청크는 선택적 `metadata.sourceSegment`로 입력 구간의 0 기반 번호를 참조한다. 라벨 없는 틈에는 번호를 만들지 않으며 파일 수준 locator·metadataParts 원장을 각 청크에 복사하지 않는다. 구간 없는 정상 평문은 기존 planner로 바로 전달해 segment 전용 32MiB 한도를 새로 적용하지 않는다. 본문 hash와 metadata JSON hash는 Rust `create_content_hash`로 별도로 계산한다.

source preparation의 `bodyPlan` v1은 codepoint를 끊지 않는 최대 64KiB UTF-8 비중첩 범위와 byte/UTF-16 전체 길이를 반환한다. 빈 원문은 명시적 0블록이다. 준비 charge는 plan metadata와 raw block I/O의 두 UTF-16 작업 사본을 포함하고, 미래 scan 전체 작업량을 중복 가산하지 않는다. `scanChargeBytes`는 raw와 최장 행 projection/블록 수신의 보수적 논리 peak이며 RSS가 아니다. 같은 runtime의 producer·reader가 같은 식으로 확인하고 페이지 출력은 caller cap 안에 추가 예약한다. wire·객체 표현이 달라지는 변경은 저장된 plan 호환성도 검토한다.

source preparation의 선택적 `maxChargeBytes`·`maxPreparedChunks`는 반환할 prepared 결과의 상한이며 기본 1GiB 안전 한도를 완화하지 않는다. 잘못된 한도는 `invalid-preparation`, 본문·metadata·청크 결과의 초과는 내용 없는 `memory-budget` 실패다. metadata-only 자료도 charge와 원장을 보존한다. 입력 예약을 합친 snapshot 예산과 요청 cap의 운영 worker 검증은 `retrieval-index`가 소유한다.

`plan_rag_status_json`의 record에는 선택적인 `sourceIncomplete`를 받는다. 최신 revision·모델인 부분 원문도 healthy가 아니라 unknown/source-partial이며 decode 실패의 failedDocuments와 구별한다. 기존 wire 입력에 필드가 없으면 legacy 동작을 유지한다. source worker는 기존 decoder·추출 export를 실행할 뿐 새 TS decoder나 추출 알고리즘을 만들지 않는다. 이 wire와 BM25 source replacement 동작을 배포하려면 부모가 WASM과 기존 XLSX/BM25 worker 자산을 함께 재생성해야 한다.

## 구현·검증 근거

`src/lib.rs`, `src/indexed_evidence.rs`의 계획·검증 JSON 진입점과 TS wrapper가 주요 근거다. 회귀 근거는 Rust 모듈 내 테스트 및 `src/rag/rust-core.test.ts`다. 로컬 회귀 검사는 실제 앱 성능·답변 검증을 대신하지 않는다. 한도 코어의 단위 테스트와 `src/llm/provider-quota-core.test.ts`는 합성 응답·손상 wire·초기화 실패를 검증한다. 해당 소스·glue·base64와 이를 포함한 worker 생성물은 `npm run wasm:build`로 함께 갱신한다. 실제 제공자·계정·과금 상태와 성능은 이 회귀의 검증 범위가 아니다.
