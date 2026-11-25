---
id: retrieval-index
type: module-design
status: draft
title: 원문 코퍼스와 검색 색인
parent: superpower-architecture
references: [vault-evidence, deterministic-core]
---

# 원문 코퍼스와 검색 색인

## 책임과 경계

접근 가능한 vault 파일의 원문 코퍼스와 lexical·vector·structural 후보를 준비한다. 검색 순위는 조사 신호이지 최종 답변 근거 자격이 아니다. 원문 검증·답변 심사는 `vault-evidence`가 소유한다. 단어 검색은 임베딩 성공에 종속시키지 않는다.

제외 정책은 `getRagCandidateFiles`와 Rust indexability 계획에서 적용한다. 경로·확장자·채팅 폴더·파일별 YAML 제외는 플러그인 설정을 기준으로 한다. 평문은 알려진 확장자 목록만으로 한정하지 않는다. 확장자가 없거나 낯선 파일도 실제 byte를 strict decode하여 판정하고 UTF-16/32·legacy codec을 지원한다. 잘못된 바이트·binary magic을 대체문자로 덮어 평문 성공으로 만들지 않는다. 알려진 평문 확장자와 전용 추출기의 13개 구조 문서 확장자(`pdf`, `epub`, `docx`, `dotx`, `odt`, `odp`, `ods`, `pptx`, `potx`, `ppsx`, `xlsx`, `xltx`, `hwpx`)는 서로 겹치지 않는 기본 분류·제외 추천 규칙을 공유하지만 확장자가 추출 성공의 증거는 아니다. candidate·정책 excluded·unsupported·failed를 구분하고 partial·metadata-only·완전 빈 원문도 같은 성공 수나 정상 0 발견으로 합치지 않는다. 실제 추출이 필요한 명시 준비와 달리 metadata-only 후보 manifest를 만들기 위해 전체 byte를 미리 읽지 않는다. 지원 확장자와 자동 제외 바이너리 확장자는 제외 추천(`excludeRecommendations`)에 제안하지 않는다. 평문 텍스트를 후보로 인정하므로 patch·snapshot·jsonl처럼 이전에 크기 상한으로 제외되던 대용량 파생 텍스트도 색인 대상이 된다. 이는 발견 누락을 줄이는 대신 초기 색인 비용을 늘리는 의도된 교환이며, 정확성 우선 규약에 따른다. 지원 확장자 파일 하나가 손상되어 읽히지 않아도 그 확장자 자체를 제외 추천에 올리지 않으므로, 그 실패는 추천 목록이 아니라 색인 로그와 대상 형식 집계 밖에 남는다. Obsidian 파일 탐색기에 보인다는 이유만으로 검색 대상에 넣거나 Git 제외라는 이유만으로 검색에서 빼지 않는다. 정책 변경 뒤의 잔여 색인 소거와 실제 적용 여부는 별도 검증 대상이다.

## 발견 범위·예산

상위 k·검토 예산은 발견의 세계를 정하지 않는다. 같은 자료·접근/제외 범위와 정규화 조건의 Ctrl+F 기준 문서·구간을 잃지 않고, 전체 점수화·일치 총계가 전체 발견 결과의 보존을 뜻하지도 않는다. 예산 밖 결과도 경로·관련 구간·연결 단서로 추적·후속 조회할 수 있어야 하며, 답변 자격·열거 총실도는 `vault-evidence`가 소유한다.

정확성(누락·오탐·상충 근거 발견)을 최우선하고 초기 색인 비용·색인 지연·저장 사용량 증가를 감수한다. 색인이 느리다는 사실은 검색 품질 실패의 근거가 아니며, 품질을 위해 색인을 더 오래 걸리게 하는 결정을 속도만을 이유로 되돌리지 않는다.

## 원문 literal 저장과 요청 수명

원문 부분문자열의 계산·주소·집계 정의는 `deterministic-core`가 소유한다. corpus v3는 준비된 전체 추출 본문을 파일별 비중첩 `sourceBlocks` 한 벌로 보존하며 기존 청크·BM25·vector 형식을 바꾸지 않는다. 파일 기록에는 숫자 body manifest와 기존 출처 원장만 둔다. 원문·문서·파일·mutation receipt는 같은 transaction에서 교체·삭제되고 body 없는 갱신이 이전 raw를 새 hash 아래에 남기지 않는다. 청크 overlap·longline·구조 구간으로 원문을 역복원하거나 normalized fulltext/주소맵을 별도 영속 cache로 만들지 않는다.

literal 요청은 metadata-only 범위와 현재 준비의 본문/metadata hash를 고정한다. eligibility만 확인한 cache나 같은 mtime:size는 그 증명을 대신하지 않는다. 기존 준비 결과의 두 hash를 복사해 읽을 뿐 질의 중 전 볼트 byte probe/원문 재추출을 시작하지 않는다. 현재 해시가 없거나 body capability·출처·완전성·revision이 맞지 않으면 실패 폐쇄한다. 명시적 빈 본문·빈 요청 범위와 legacy 누락을 구분한다.

비동기 원장은 세대·corpus receipt·정책/source epoch와 실제 runtime lease에 묶인다. metadata keyset·원문 한 block·결과 한 페이지씩 I/O하고 source/page 저장·작업자 정착 뒤에만 complete를 게시한다. 요청 파생 페이지는 owner UUID별로 저장하며 corpus receipt를 만들지 않는다. 페이지/요약 재조회마다 currentness를 검사하고, close는 진행 read와 자기 페이지 정리 뒤에만 owner를 반납한다. 기본 검색 수집은 lazy opener만 연결하므로 일반 검색을 위해 자동 raw scan을 시작하지 않는다.

literal Worker는 기존 source 큐·컴파일 모듈·XLSX 자산을 공유한다. scan charge+16MiB의 검증된 예약을 256MiB 안에서 admission하고 literal에는 단독 oversize 예외를 주지 않는다. active I/O 취소나 callback 실패가 실제 정착보다 예약을 먼저 반환하지 않으며 Node 검증을 계측된 0 여유로 표시하지 않는다. 이 논리 예산은 전역 RSS 보증이 아니다.

설정의 명시 업데이트·전체 재구축은 main의 공통 진입점을 사용한다. 유효한 선택 설정과 명시 API가 있으면 기존 인덱서·scheduler 부재만으로 복구 진입을 막지 않는다. 초기화·실행·성능 보호 대기는 별도 시작 보호이며, 자동 legacy 재임베딩 금지는 그대로 유지한다. 명시 실행은 새 세대의 실제 구축 결과를 후속 pending 0건으로 덮지 않고, 새 runtime·완료 근거가 없으면 가짜 0건 성공을 만들지 않는다. 최종 proof가 partial이면 처리 건수를 보존한 반환 결과도 partial로 표시한다.

구자료 보충은 명시적인 업데이트 시작의 별도 model-free 경로다. 기존 본문·metadata hash와 revision을 CAS로 대조해 raw capability와 receipt만 추가하고 청크 ID·원장·vector를 재생성하지 않는다. 중단·정책·owner·barrier를 따르며 engine-only snapshot 취득을 보충 작업으로 바꾸지 않는다. metadata hash 자체가 없는 legacy나 변한 원문은 자동 덮어쓰기·재임베딩 없이 제한 상태를 유지한다. boolean/처리 계수는 완료 proof가 아니며 실제 seal 재검증을 거친다.

## 교차언어 회수

한국어 질의가 의미상 같은 한국어·영어 문서를 같은 경로에서 회수하고, 가능한 자료에서는 라틴어까지 자연스럽게 이어지는 다국어 브리지를 기본 동작으로 둔다. 언어별 별도 모드·분기나 정답 언어 고정으로 대체하지 않는다. 라틴어 문서를 비정답 후보로 두거나 한↔영 단일 정답만 검증하는 구성은 요구를 충족하지 못한다.

## 판정 수단

관련성 판정을 위해 MiniCheck·HHEM 같은 별도 ML 판정 모델이나 추가 모델 다운로드를 도입하지 않고 결정적 기계 검수로 처리한다. 검색 엔진은 품질을 위해 내부 아키텍처를 전면 재작성할 수 있으나 제품 역할·범위(Obsidian 활용·정확한 볼트 정보·MCP·일반 채팅)를 축소하지 않는다.

## 저장·준비·실패

인덱서는 한 후보 manifest와 바이트·청크·호스트 시간으로 제한한 준비 window를 소비한다. window의 snapshot·본문 hash·청크를 corpus와 BM25에 재사용하고 실제 corpus 저장 및 `IndexedDbBM25Index.flush()`의 IndexedDB 커밋·작업자 ACK 뒤에만 교차 파일 임베딩을 요청한다. `persist()`는 외부 `withBatch` 안에서 지연될 수 있으므로 내구 checkpoint로 사용하지 않는다. 소비한 준비 본문·청크·임시 벡터 참조는 window마다 해제한다. dense 준비는 별도 전체 corpus refresh·BM25 rebuild를 중복 실행하지 않고 같은 lexical-first indexer를 소비한다.

corpus·lexical 쓰기 전에 vector 저장소의 owner 있는 복구 요청을 등록한다. 현재 본문을 다시 읽은 hash·파일 identity·revision·제외 정책·호스트 소유권 callback을 확인하고, 벡터와 파일 기록의 원자 커밋 및 사후 재검증 뒤에만 완료를 게시한다. 실패·중단 때 성공 flush하지 않으며 이전 owner가 새 owner의 복구 요청을 지우지 못한다. 파일시스템과 corpus·BM25·vector DB 전체를 묶는 단일 transaction은 보장하지 않는다. 검사 직후의 변경 및 다른 인덱서 인스턴스와의 경합은 조립 계층의 lease·이벤트 연결도 필요하다.

`SourceFileSnapshot.sourceMetadata`의 구간 출처·locator·빈 시트 `metadataParts`·PDF completeness는 파일 기록에 한 번 저장한다. 청크에는 작은 구간 번호만 둔다. 본문 없는 metadataParts는 인용 구간에 합치지 않는다. metadata hash와 본문 hash는 별도이며 위치만 바뀐 청크의 벡터 재사용도 실제 청크 ID 대응이 확인된 경우로 제한한다. 출처 메타데이터 필드는 기존 IndexedDB 키와 legacy 자료를 삭제하거나 일괄 이관하지 않고 추가한다. 원문 block 테이블 도입은 위 literal 저장 계약을 따른다. 구세대 청크 ID가 대응하지 않으면 기존 좌표를 임의로 만들어 덮지 않는다.

진행의 completedFiles는 실제 내구 저장·사후 확인된 완전 파일만 센다. processedFiles·failedFiles·partialFiles·skipped와 stage는 구별한다. 부분 PDF의 유효 본문은 보존하되 완료 성공으로 세지 않고 근거 coverage는 incomplete다. 현재 revision의 terminal partial은 자동 pending 재시도에서 제외하고 수동 시도·새 revision은 다시 준비한다. 0청크 완전 자료도 실제 파일 기록·corpus 저장과 현재 검증 뒤 완료 수 및 성공 예상량 원장을 정착하지만 실제 청크·벡터·속도 표본을 만들지 않는다. 기존 `IndexingResult.skipped`의 빈 파일 호환 반환은 이 완료 원장이나 세대 proof가 아니다.

ETA 관측은 파일별 논리 batch 시간과 구별한 비중복 pipeline window wall을 사용한다. 준비 전부터 lexical·prefetch·vector 저장/확인·lookahead 정착까지 한 번 재며, 실패·부분·skip·실패 재시도·무효 owner 구간은 속도 표본에 넣지 않는다. 물리 추론은 `provider-boundary`의 확인된 공개 관측과 실제 dispatch 수가 대응할 때만 귀속한다. 최근 표본은 각 64개로 제한하고 게시 사본을 private 원장과 분리한다. job·backend·취소/재실행을 넘겨 표본을 섞지 않으며 v1 속도 metadata를 새 관측으로 승격하거나 삭제하지 않는다. 파일 총량의 확정과 청크 계획 완료는 별개이고, heartbeat는 관측 시각을 바꾸지 않고 Rust ETA를 다시 평가한다.

공유 요약은 검색에 사용 가능한 serving과 building의 초기 준비·처리·마무리·부분/실패·사용자 중단을 분리한다. 전체 완료 시간과 pipeline 부분 추정·물리 설명 성분도 별도 필드다. 최종 DB proof·manifest 게시/전환 시간이 미관측이면 전체 ETA는 계산 중이며 문서 수·처리 종료·scheduler return만으로 완료를 게시하지 않는다. 입력창·설정·검색은 이 요약을 공통 display/renderer로 소비하고 같은 snapshot의 수치를 사용한다. snapshot의 명시적 null을 이전 status·별칭의 수치로 대체하지 않으며 수치 갱신에서 DOM 제어를 재생성하지 않는다. 공통 `work`는 building/indexer 생성 전 저장소 열기·corpus/키워드 복원부터 모델 준비·계획·원문 준비·lexical·임베딩·벡터 저장·검증·게시·대기·물리 정리까지 실제 owner의 대기를 관측한다. 단계 수량은 실제 count와 적재/저장 ACK이며 미상 총량을 처리량으로 대체하지 않는다. 최근 64개 표본과 단계 시각으로 얻은 단계 ETA는 전체 ETA와 독립적이다. 진행 pulse는 scalar 표시만 갱신하고 전체 볼트 통계·파일 형식 조사를 재실행하지 않는다. scheduler heartbeat는 새 단계 관측이 아니며 모델 준비 완료 ACK 뒤에는 실제 대기하던 indexer 단계로 돌아간다. 늦은 owner·취소·unload의 callback은 새 작업을 변경하지 않고 정리 표시는 기존 물리 drain 정착까지 유지한다. 표시·펼침·포커스와 ETA 범위 고지는 `interface-design`이 소유한다. 실제 화면 검수·ETA 오차 실측은 별도 검증이며 이 데이터 계약이나 합성 DOM 검사만으로 합격을 보증하지 않는다.

동일 revision의 terminal partial 자동 시도 억제는 이미 내구 저장한 corpus files의 metadata를 우선 사용하고 corpus 행이 없을 때만 vector 파일 기록을 사용한다. 실패·미검증·내구 recovery까지 합친 pending 범위에 같은 Native 계획을 적용한다. 정상 본문·metadata hash와 stat·정확한 partial 상태가 필요하며, 알려진 current hash 불일치·source 사건·legacy 누락은 억제 근거가 아니다. cold cache 부재는 변경 증거나 현재 내용 proof가 아니므로 같은 stat의 정상 내구 행을 자동 시도 억제 힌트로만 사용할 수 있다. 무이벤트·같은 stat의 실제 내용 변경을 이것만으로 판별한다고 주장하지 않는다.

자동 coordinator는 coverage pending과 actionable/deferred를 구분한다. deferred-only면 추가 자동 기회·완료 fingerprint·healthy maintenance를 게시하지 않으며 debt·owner·기존 serving·중단 상태를 보존한다. maintenance의 파일별 auto admission도 같은 계획을 따르며 가짜 vector·빈 완료 행으로 우회하지 않는다. manual/full/update·실제 source 사건·새 revision은 다시 준비할 수 있다. metadata I/O 전후 source epoch·파일 identity/stat·파일/실행 owner·취소를 재확인하고 아직 처리하지 않은 source 사건을 runtime 교체로 지우지 않는다. 관측한 사건의 경로는 같은 stat의 추출 cache·미리 준비한 snapshot을 재사용하지 않고 fresh 준비로 읽으며, 그 lexical commit과 동일 epoch의 currentness 확인 뒤에만 사건 표시를 해제한다. 억제는 현재 원문·완료 세대 인증이나 여러 DB 전체 원자 커밋을 뜻하지 않는다. 잠긴 current source reader도 준비된 sourceMetadata를 전달한다. 원문 보충은 위 명시적 CAS 경로로 한정하고 metadata hash 없는 구세대 행은 제한 상태로 남긴다.

source worker는 바이트 decode·컨테이너 추출·hash·chunk 준비에 컴파일된 WASM 모듈을 재사용한다. dispatcher는 실제 작업 최대 둘 중 background를 하나로 제한하고 다음 dispatch에서 foreground를 우선한다. 소비자 취소만으로 실제 읽기 예약이나 background 슬롯을 반환하지 않으며 작업의 실제 정착 뒤 해제한다. 256MiB 입력 예약과 기존 단독 큰 입력 예외를 유지하므로 메모리 예산에 막힌 foreground의 즉시 실행까지 보장하지 않는다.

다음 source 하나의 준비는 실제 로컬 inference dispatch 뒤 `deterministic-core`의 허용 판정이 있을 때만 겹친다. 현재 window와 다음 snapshot은 같은 8MiB 논리 charge·4096청크 예산을 공유한다. 다음 입력 예약(size×4)을 먼저 빼고 남은 prepared charge·청크 cap을 Rust에 전달하며, 운영 worker 응답도 동일 요청 cap으로 검증한다. 반환 snapshot의 실제 전체 charge를 다시 확인하고 다음 window에서 currentness를 재검증한 뒤에만 직렬 corpus·BM25 저장에 사용한다. speculative 실패는 해당 실행의 최적화만 중단하고 정상 순차 준비로 돌리며 문서 성공·완료를 만들지 않는다. 이 예산은 실제 RSS나 모델·벡터·PDF 전용 큐를 합친 전역 메모리 상한이 아니다. 물리 표본·로컬 microdispatch의 소유자는 `provider-boundary`이고 실제 앱의 지연·처리량·CPU/GPU 활용 개선은 별도 실측이 필요하다.

공통 readiness는 구축 진행이 아니라 요청에 사용할 serving 세대를 기준으로 한다. 사용 가능한 serving이 있으면 building·refresh·pending update 중에도 그 고정된 세대를 사용하고 부분 building을 섞지 않는다. serving이 없을 때 preparing/indexing을 표시하며 corpus 또는 BM25가 존재한다는 사실만으로 dense/hybrid를 포함한 전체 준비 완료를 인증하지 않는다. 취소·교체·읽기 실패와 정상 빈 결과를 구분한다.

호스트 복원의 최초 오류와 관측 단계는 현재 owner·run에 귀속된 메모리 전용 진단으로 보존하고 기존 초기화 오류나 저장 manifest에 덮어쓰지 않는다. 복원 시작은 이전 진단을 지우며, 늦은 owner·취소·unload는 새 진단을 게시하지 않는다. 실제 복원 진행·실패는 과거 building 이력보다 우선하고, 현재 live 구축의 실패는 해당 초기화 사유를 사용한다. 같은 계약의 hydrate 실패도 manifest 변경 없이 live 실패로 게시한다. 저장 이력은 당시 원인·단계를 기록하지 않았다면 현재 오류를 빌리지 않는다. 준비된 BM25 또는 완료 세대를 게시하면 이전 복원 오류를 숨긴다.

기존 임베딩 계약에 연결 binding이 없으면 자동 재구축을 시작하지 않는 보호를 유지한다. 호스트는 이 조건을 명시적 업데이트 필요 상태로 전달하며, 그 사실만으로 원문 누락이나 실행 중인 구축을 추정하지 않는다. 오류 출처·상태의 화면 표현은 `interface-design`이 소유한다.

청킹 세대와 legacy 직렬화 호환성을 보존한다. Markdown의 헤딩·코드블록·위키링크·임베드 경계를 단순 줄바꿈 분할로 대체하지 않는다. 캐시와 색인은 재생성 가능한 생성물이지만 사용자 노트·세션은 아니다.

## 영속 변경과 세대 증명

corpus·BM25·vector 저장소는 DB-local incarnation·mutation UUID receipt로 변경을 식별한다. 실제 데이터·metadata·복구 원장·owner 쓰기와 receipt 갱신은 같은 IndexedDB transaction에서 커밋되거나 함께 rollback된다. 읽기·legacy migration만으로 완료 receipt를 만들지 않으며 빈 초기화도 authoritative 데이터·복구 요청이 정말 없는 경우로 제한한다. 이는 협력하는 writer의 변경 감지이지 암호학적 무결성이나 여러 DB의 원자 커밋 보장이 아니다. 알 수 없거나 sparse인 복구·실패 원장은 빈 상태로 정규화하지 않는다.

토큰 버전이 다르거나 소유 manifest를 해석할 수 없으면 그 snapshot을 새 규칙의 runtime에 적용하지 않지만, 새 완료 snapshot 게시 전까지 기존 metadata·블록을 자동 삭제하지 않는다. 해석 가능한 구버전 manifest의 저장 order도 단조 원장 복원에 포함한다. 미해석 소유권을 고아 없음으로 바꾸지 않으며 orphan sweep을 보류한다. 구토큰의 제한 읽기·혼합 증분은 `deterministic-core`의 버전 규칙을 따르고 현재 토큰 계약이 아닌 runtime에는 완료 applied proof나 새 snapshot 게시 권한을 주지 않는다.

BM25의 호스트 논리 revision, transaction 안에서 할당하는 DB 저장 order, wire 요청 ID는 서로 다른 순서다. 작업자 session에서 연속된 revision·part의 실제 Rust/DB 적용이 성공한 뒤 마지막 part ACK만 applied revision을 전진시킨다. 새 session·검색·진행·직렬화 응답이나 최신 nonce echo는 기존 mutation 적용 증명이 아니다. snapshot은 실제 직렬화한 prefix와 저장 head/order/session의 CAS가 맞을 때 block·manifest를 함께 게시하며, 다른 owner의 head 뒤에 자기 delta 하나를 썼다는 이유로 전체 projection을 인증하지 않는다.

main은 active/building 저장소를 분리하고 현재 검색이 고정한 handle을 writer·query·provider의 실제 작업이 끝날 때까지 보존한다. writer는 병렬 동작을 유지하되 완료 checkpoint는 기존 작업 뒤에서 새 admission을 막는다. debounce 전 source·metadata 사건도 즉시 checkpoint epoch를 무효화한다. 완료 manifest에는 현재 원문·청크·projection·정책·owner 검증과 재확인한 store receipt, 현재 BM25 session/applied revision, 명시적인 lexical/vector enabled·disabled·ephemeral 상태가 필요하다. 증분 갱신은 manifest revision·active ID·직전 seal CAS로 같은 세대를 갱신하며 building을 덮어쓰지 않는다. building cutover는 기존 writer/checkpoint 뒤 최신 manifest에서 자기 building ID·상태·owner를 재확인하여 무관한 active proof 갱신과 소유권 상실을 구별한다. 영속 commit 뒤 게시가 무효화되면 commit 이후 revision·active ID·seal·살아 있는 이전 owner를 같은 transaction에서 확인해 이전 active 포인터만 복원하고 다음 building과 중단 상태는 보존한다. 닫힌·삭제 중인·교체된 owner는 복원하지 않는다. 동일 계약 hydrate도 이전 complete를 복사하지 않고 새 session과 현재 원문을 checkpoint에서 재검증한다. cold restore는 저장 receipt 일치만으로 새 작업자 session을 승격하지 않고 현재 원문과 실제 hydration을 다시 확인한다. 누락·재생성·legacy·불일치 저장소는 기존 lexical serving을 제한 상태로 보존하고 자동 삭제·재임베딩으로 합격 처리하지 않는다. 실패·partial은 전체 complete가 아니다.

BM25 worker 장애와 index owner의 퇴역은 구분한다. 살아 있는 owner의 장애만 기존 제한 복구로 새 작업자 세션을 만들 수 있으며, 명시 close·삭제·교체 뒤의 이전 continuation은 worker를 생성하거나 새 세션을 교체하지 않는다. 초기 복원·snapshot fallback·변이의 비동기 경계에서 generation·worker identity·종료 상태를 재확인하고, 실패한 같은 세션의 후속 연산은 실제 worker에 보내지 않는다. 상위 실패 기록은 작업자의 최초 종료 사유를 보존해 후속 closed 오류로 덮지 않는다. 저장된 원문·receipt·order와 아직 정착하지 않은 변경 원장은 실패를 숨기거나 거짓 ACK를 만드는 대신 기존 내구·복구 계약으로 처리한다.

background BM25 load와 장애 복구의 실제 Promise도 같은 runtime의 기존 barrier·lease 수명에 귀속한다. 퇴역은 새 admission·진행·성공 게시를 막되 이미 시작한 물리 작업의 정착 전에 worker·store를 닫지 않는다. 완료 checkpoint는 자신이 기다리는 작업 안에서 다시 시작하지 않으며, 정상 준비의 no-op 복구로 read currentness를 무효화하지 않는다. 사용자 중단과 기존 복구 횟수 제한은 유지한다.

## 증분 색인 불변식

dirty·stale·missing 판정은 파일 내용 hash와 revision을 단일 출처로 삼는다. 시작·폴링·vault 이벤트·recovery가 같은 파일을 중복 스케줄하지 않고, 내용 변경이 없으면 재색인·상태 갱신을 하지 않는다. 같은 변경을 여러 경로가 다시 처리해 사용량을 태우지 않는다.

## 실패 격리와 중단

파일 크기·예산 초과는 해당 파일을 건너뛰고 나머지를 계속 색인한다. OCR 신뢰도가 낮은 페이지 하나로 전체 색인을 중단하지 않고 해당 근거만 제외한 채 진행한다. 다중 파일 색인은 계획 단계의 청크·해시를 재사용하고 여러 문서의 청크를 교차 파일 임베딩 배치로 묶어 처리량을 높인다. 처리 중인 개별 파일명은 사용자에게 노출하지 않고 진행 규모·범위만 보여 준다. 색인 진행 정보는 ETA와 처리 범위를 포함하고, 스킵된 파일은 처리 속도·오버헤드 표본에서 제외하며, 색인이 없는 상태와 문서 0건을 구분한다.

사용자 중단은 자동 복구·자동 재개까지 멈추며, 런타임 재초기화·설정 저장·스냅샷 복구 뒤에도 그 상태를 유지한다. 재개 진입점은 설정의 `업데이트 시작` 하나이며, 중단 뒤 재개·백로그 처리를 함께 담당한다. 의미가 같은 별도 `지금 재개` 제어를 두지 않는다. 자동 복구는 한 기회에 최대 256개·16MiB를 처리하고, 대기 수가 줄면 재시도 backoff가 아니라 짧은 간격으로 다음 배치를 이어 붙여 세션 한도 안에서 백로그를 소진한다. 크기가 큰 지원 문서도 배치에 포함한다.

## 계약 버전과 원문 보존

저장 원문은 원문 그대로 유지하고 검색용 접두·메타데이터는 별도 projection에만 둔다. `RAG_INDEX_CONTRACT_VERSION`(5)과 `createRagIndexNamespace`가 청킹 계약·크기·오버랩으로 세대 이름을 만들고, 값이 바뀌면 새 세대 색인을 다시 만든다(`src/rag/storage-lifecycle.ts`). 구세대 색인 폐기는 자동 실행하지 않고 설정에서 승인한 `RetiredArtifactService.cleanup` 경로가 소유한다. 활성 DB는 보호하고 현재 접두의 과거 `vectors`·`corpus`·`bm25` 세대는 승인 정리 대상으로 찾는다. 모델별 `embedding-cache`는 색인 세대 변경만으로 폐기하지 않지만, 지원 종료된 legacy 캐시 형식은 별도 폐기 정책을 따른다. 레거시 `graph` DB와 등록부에서 지원 종료로 판정한 생성물도 정리 범위에 포함될 수 있다. 승인·revision·활성 여부 재확인은 [생성물 정리 계약](../storage/SPEC.md)이 소유하고, 구체적 이름 판정은 `crates/rag-wasm/src/retired_artifacts.rs`, 회귀는 `src/storage/retired-artifacts.test.ts`에서 확인한다. 전체 플러그인 데이터 초기화는 `resetPluginData`가 `deleteRagIndexedDbGenerations`로 별도 삭제한다. `cleanupStaleIndexedDbGenerations`는 이 경로와 별개의 제한 배치 도우미이며 런타임 호출자가 없고 회귀 테스트만 호출한다.

## 교체 계약

임베딩 모델·토크나이저를 교체하면 재색인 후 검색 품질이 같거나 좋아야 한다. 교체 전에 그 조건을 판정할 수 있어야 하며, 판정 없이 교체하고 품질 저하를 사후에 정당화하지 않는다.

## 구현·검증 근거

`vault-document-corpus.ts`, `indexer.ts`의 `VaultIndexer`, `query.ts`의 `RAGQueryEngine`, `retrieval-pipeline.ts`의 `RetrievalOrchestrator`가 책임의 근거다. 파일별 corpus transaction은 `document-corpus-store.ts`, 저장 세대는 `storage-lifecycle.ts`에서 확인한다. 관련 회귀 근거는 `indexer.test.ts`, `query.test.ts`, `document-corpus-store.test.ts`, `storage-lifecycle.test.ts`다.

이 문서는 준비·보존의 의도와 관찰된 보호 장치를 기록한다. 색인 전체의 무누락·실제 볼트 정책 소거·재시작 후 단서 보존을 이번 편입에서 실행 검증한 것은 아니다.
