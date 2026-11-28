---
id: engineering-contract
type: architecture-design
status: draft
title: 구현·데이터 보호와 검증 계약
parent: superpower-architecture
references: [deterministic-core, interface-design, release-contract, provider-boundary]
---

# 구현·데이터 보호와 검증 계약

## 경계와 변경의 단위

제품 구조는 `superpower-architecture`, 결정적 계산·생성물 경계는 `deterministic-core`, UI는 `interface-design`이 정본이다. 코드와 목표가 다르면 차이를 기록하며 문서 정리로 구현 완료를 선언하지 않는다. 절차·질문·TODO·검토·PR은 ThinkRail 내장 워크플로우를 사용하며 별도 제품 자동화로 중복 제어하지 않는다.

Markdown 청킹의 헤딩·코드블록 경계와 위키링크·임베드 의미를 보존하고 단순 줄바꿈 청킹으로 바꾸지 않는다. 저장 형식의 legacy load·round-trip도 유지한다. 새로운 계산·검증은 Rust/WASM 소유이며 호스트의 I/O 조율과 구분한다.

## 런타임 구현 규약

- 사용자 표시 문자열·기본 프롬프트·도구 설명은 `src/i18n.ts`의 한국어·영어와 `t()`를 사용한다. 다른 런타임 TS에 한국어 리터럴을 추가하지 않는다. named import/export와 `import type`을 우선한다.
- 파일은 Obsidian `app.vault`·adapter·cachedRead/modify/create, 네트워크는 `requestUrl`을 사용한다. 런타임 fs·browser fetch·웹 쿠키 크롤링·환경변수 의존을 늘리지 않는다. 환경변수는 기존 MCP PATH 예외를 유지한다. buffered 응답과 best-effort abort 능력을 정확히 표현한다.
- DOM은 Obsidian 생성 API와 ownerDocument, 필요하면 activeDocument를 사용한다. cross-window narrowing은 node.instanceOf 또는 isDomInstance로 한다. innerHTML/outerHTML 대입·style 직접 대입·inline style·createEl의 h1~h6를 금지한다. class로 표시·숨김, setCssProps로 동적 값, setIcon으로 아이콘, Setting.setHeading으로 설정 제목을 만든다.
- Markdown은 MarkdownRenderer.render(app, markdown, el, sourcePath, component), 확인·입력은 confirmWithModal·promptWithModal을 사용한다. 줄바꿈은 text node와 br로 만든다.
- 설정 내부 refresh는 private helper로 수행하며 display를 직접 재호출하지 않는다. 범위 설정은 min/max/step이 있는 숫자 입력을 사용한다. 기존 helper·테마 의미 토큰·안전한 기본값·자동 감지를 먼저 검토한다.
- provider 변경은 키·label·기본값·설정·createProvider·validation 및 메시지/스트림/tool call 계약을 함께 확인한다. saveSettings의 provider/RAG 재초기화·MCP 재연결 부작용을 보존한다. 비밀정보 처리는 `provider-boundary`가 소유한다.
- 로그는 src/utils/logger.ts와 점 표기 source를 사용한다. trace=반복 상세, debug=전환, info=시작, notice=성공, warn=복구 가능, error=실패, fatal=핵심 중단이다. 429·재시도·backoff·취소·대체·skip 이유를 기록하되 키·토큰·쿠키·credential을 기록하지 않고 console을 추가하지 않는다.
- 네이티브 볼트 도구는 읽기 전용이고 MCP 신뢰·승인·취소 경계를 보존한다. 데스크톱 전용을 전제로 한다. 의존성 변경은 package-lock.json도 함께 맞춘다.

## 의존성·측정 규약

외부 라이브러리는 개념을 참고해 자체 구현하는 쪽을 우선한다. 동작을 보증할 수 없는 직렬 의존 체인을 만들지 않고, 구현 이득이 없는 구간에서만 생략·단순화한다.

검색·성능 비교는 질의 파싱을 포함한 같은 측정 경계와 동등한 내구성 설정에서 수행하고 build·persist 시간을 분리해 기록한다. capped hit을 recall로 부르지 않고, 측정 환경을 Obsidian 실제 사용으로 일반화하지 않으며, 외부 README의 속도 수치를 자사 성능 근거로 쓰지 않는다.

## 프롬프트 작성

프롬프트는 목표·관련 근거·필요한 출력·실제 경계를 명확히 하고 과도한 단계 강제나 사고 과정 출력을 요구하지 않는다. 사용자 선택 모델·추론을 문서 최적화에 끼워 바꾸지 않는다. [ChatGPT 공식 프롬프팅 가이드](https://learn.chatgpt.com/docs/prompting)를 기준으로 삼고, GPT-6.1 Sol 대상이면 [모델 문서](https://developers.openai.com/api/docs/models/gpt-6.1-sol)·[프롬프팅 지침](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)도 실제 작업에서 확인한다. 이 링크 편입은 이번 작업에서 외부 문서 최신성을 재검증했다는 뜻이 아니며 모델별 권고가 provider·도구·저장 계약보다 우선하지 않는다.

## 검색 품질 게이트·측정

naive Ctrl+F보다 품질이 낮은 사례는 사례 단위 실패로 처리해 build·release를 막는다. 게이트는 질의 파싱을 포함한 제품 검색 경로를 실행하고, 합성 fixture·공개 벤치마크·다국어 병렬 자료 같은 복수 절대지표를 쓰며, capped hit을 recall로 부르지 않는다. 릴리스 중단은 `release-contract`가 소유한다.

개선 사이클은 착수 전에 목적·기대 효용·사용자 체감 지점·측정 계획을 밝히고, 종료 시 결과·남은 한계·다음 후보를 남긴다. 실질 개선이 확인되지 않으면 작업을 늘리지 않고 중단 사유를 기록한다.

## 검증 상태와 이력

2026-10-29 기준. 상세 실행 서사는 남기지 않고 날짜·커밋(있으면)·확인 범위·명령·종료 상태·반복 횟수·차단·한계만 기록한다. 반복 측정한 검증은 횟수를 명령 열에 함께 적는다. 아래 표는 날짜별 실행 기록이고 현재 상태는 바로 다음 '현재 코드 재검증' 문단이 소유한다. 원문·문서명·질의·답변·개인 설정은 스펙·기억에 복제하지 않는다.

**현재 작업 트리의 검증 경계:** 독립 소비/평가 검토의 P2 네 건을 회귀부터 보완하고 재리뷰에서 모두 Closed/Approve를 받았다. 마지막 source 사건의 fresh 준비 보완 뒤 `quality:local`은 unit 3,575 passed·기존 1 skipped, 계약 186, Rust 729 passed·기존 2 ignored 및 전체 gate로 exit 0이다. 후속 production은 3,704,676 / 5,000,000 bytes다. 같은 Native 상태의 오프라인 RAG wrapper performance gate도 exit 0이며 실앱 처리량의 증거는 아니다. NFKC/token-v4 뒤 드러난 BM25 token 0과 원문 부분문자열 4회의 정의 차이는 서로 다른 단위로 보존하고, 호환되는 원문 literal API·요청 원장·현재 hash/출처 대조·dossier 연결을 추가했다. 최신 `quality:loop`는 독립 8사례의 필수 정보 18/18·발견/인용 누락 0·문서/행/발생과 실제 전 페이지 대조·provider/embedding/network 0으로 exit 0이다. 긴 영문 단어 내부 발견도 포함하며 기존 필수 assertion을 완화하지 않았다. corpus 저장·Native core·공유 Worker는 지정 범위 독립 승인을 받았고 당시 Native 725 passed·기존 2 ignored 및 부분 코호트가 통과했고, 소유권·보충·MAIN 범위도 독립 승인을 받았다. 조사/평가 범위의 최종 await 뒤 무효화, 대표 96개 슬롯, 추가/중복 정규화 needle 전수 대조, opener 부재 표시도 위 재리뷰·전체 검사 범위에 포함된다. 실제 111문서의 기존 후보 110개·검토 96개 밖 새 단서가 현재 원문 검증과 dossier에 도달하는 합성 회귀를 유지한다. 실제 field 6사례의 통과도 기존 bare BM25 benchmark RED의 면제나 실제 볼트 합격이 아니다. 필수 정보 보존과 별개로 밀도 개선·전체 recall·실제 모델 효과는 입증하지 않았으며 상세 근거는 artifact, 남은 순서는 ThinkRail TODO가 소유한다.

`security:full`은 현재 개편에서 미실행이며 그 결과를 위 로컬 GREEN·배포 크기·오프라인 성능으로 대체하지 않는다. README의 나머지 색인 문서를 검토에서 제외하지 않고 각 원문 구간의 채택·제외를 판단한다는 약속도 현재 bounded 원문 심사와 동등한 보장이 아니다. README는 `release-contract`의 수정 권한에 따라 보존하며 이 차이를 실제 품질 합격으로 숨기지 않는다. 일반·승인 재개 채팅 호출부의 literal 옵션·source currentness·재개 scope·후속 최소 DTO를 보완했다. 정리 await 뒤 무효화 P2도 실제 다섯 회귀부터 수정해 지정 재리뷰에서 Closed/Approve를 받았고, 해당 66파일·846 tests 및 lint는 통과했다. corpus-only partial 실패도 coverage debt·owner를 보존한 Native deferred 계획으로 보완했다. 마지막 단일 독립 검토는 같은 stat의 관측 source 사건에 이전 추출 cache를 써 사건 표시를 지울 수 있는 P2를 지적했다. 부모가 실제 cache/PDF 경계의 assertion RED 1건부터 fresh 준비·preloaded snapshot 우회로 수정하고 위 최종 전체 검사를 통과했다. 원 검토의 Request changes를 소급 승인으로 바꾸지 않으며 사용자 결정대로 추가 독립 재검토·광범위 감사를 열지 않았다. 로컬 구현·검증 checkpoint는 여기서 마무리하고 실제 앱 e2e는 이번 마무리 범위에서 분리한다.

후속 BM25 복원 보완은 posting 문서 ID 공유·치명적 WASM instance 재사용 차단·현재 복원과 저장 이력의 진단 분리를 구현했다. 최종 `quality:local`은 lint·typecheck·unit 7,296 passed/2 skipped(기존 보관 작업 사본 포함)·오프라인 계약 186·Rust 737 passed/2 ignored·review·유출 검사 exit 0이고 독립 리뷰는 Approve다. `preview:verify` 48개 화면을 통과했으며 관련 합성 캡처를 직접 확인했다. 최신 3,745,971-byte 빌드의 실앱 모델 없는 기존 복원에서 BM25 135,835개가 저장 건수와 일치하고 준비 상태 정상·현재 복원 오류 없음·같은 세대의 검색 응답 완료를 확인했다. 실제 DOM은 이전 구축 이력과 현재 작업 없음을 구분했다. 이번 복원 API 대기는 약 18분 55초여서 기동 성능 개선은 미완료다. 실앱 픽셀 캡처는 빈 화면이라 증거에서 제외했다. 원래 trap의 정확한 내부 명령 원인·실제 의미검색/답변 품질·외부 장애 무발생은 확인하지 않았으며 강제 재색인·모델 호출·DB 삭제·커밋·푸시는 수행하지 않았다.

BM25 작업자 수명 보완은 초기화·스냅샷 복원·큐·복구의 세대/identity/종료 검사, 최초 종료 사유 보존, terminal index의 재진입 차단 및 실제 load/recovery의 기존 barrier·lease 귀속을 구현했다. 추가 합성 회귀는 core 24개·host 13개·부모 재구축 잠금 2개이며 기존 assertion을 완화하지 않았다. 최종 `npm run quality:local`은 lint·typecheck·unit 7,266 passed/2 skipped(기존 작업 사본 포함)·오프라인 계약 186·review·볼트 유출·diff exit 0이다. 부모 지정 6파일 292 tests와 독립 리뷰 지정 372 tests가 통과했고 리뷰는 Approve다. `preview:build`·`preview:verify` 44개 case exit 0과 실패·사용자 중단의 관련 캡처를 재확인했다. `node esbuild.config.mjs production`은 3,728,437 / 5,000,000 bytes로 exit 0이다. 기존 번들은 Git 제외 공간에 보존했으며 실제 앱 재로드·최초 외부 종료 원인 재현·커밋·푸시는 하지 않았다. 이 합성 수명 검증은 실제 볼트·모델 품질이나 외부 장애 무발생 보장이 아니다.

이전 checkpoint의 공통 UI preview 29개 case는 공식 reference/app.css 부재로 최종 검수가 미실행이었다. 이후 공통 작업 실패 사유 UI 변경은 설치된 기준 자산으로 `npm run preview:build`·`npm run preview:verify` 44개 case exit 0을 확인하고, 실패·미기록·정상·접힘/펼침·설정/검색·좁은 폭·밝은/어두운 테마의 해당 캡처를 직접 검수했다. 최종 `npm run quality:local`은 lint·typecheck·unit 7,201 passed/2 skipped(기존 작업 사본 포함)·계약 186·review·볼트 유출·diff exit 0이며, 독립 재검토는 미기록 단계 표시 P2 해소 후 Approve다. 기존 번들 백업 후 `node esbuild.config.mjs production`으로 3,725,221 bytes 빌드를 확인했다. 실제 앱 재로드·새 실패 재현은 수행하지 않았으며 이 UI 검증을 실제 검색·모델 품질 승인으로 대체하지 않는다. 사용자 결정에 따라 실앱·화면·ETA 오차·자원 성능·실제 볼트·대상 모델별 표시 답변 검증은 마지막 통합 단계에서 함께 수행한다. 앱 임의 실행이나 사용자 모델·설정·중단 상태 변경은 이 결정에 포함되지 않는다.

**2026-11-27 운영 재검증:** Windows production 빌드·합성 품질 루프는 통과했다. 기존 검색 세대가 복원된 실제 테스트 볼트에서 일반 채팅 1건의 저장·재열기와 이전 세션 보존을 확인했다. 제품 원문 검증을 통과한 저장 인용 중 2/3이 독립 원문 행 대조에서 한 행 어긋났다. 채팅 scope 무효화와는 별개이며, 복원 직후 저장 body의 stat 일치도 현재 본문 해시 준비를 대신하지 못한다. 그 실행에서는 참고답안 충족을 입증하지 못해 후속 4건은 실행하지 않았다. 이후 최종 프롬프트·facet 전달 수정본으로 일반 채팅 5건 모두를 재실행했다. 저장·재열기 5/5와 현재 원문 행 대조 12/12는 통과했으나 최종 생성 답변은 4/5였다. 비교·조건·예외의 의미 충족과 모델별 3회 합격은 여전히 입증되지 않았다.

**2026-11-28 통합 빌드 실측 범위:** 아래 두 회차는 복원과 채팅 검색·답변 변경이 함께 들어간 빌드의 과거 측정이다. 분리된 복원 전용 빌드의 측정이나 비교 답변의 승인 근거가 아니다. 최신 회차 기록의 크기(3,913,389 B)와 일치하는 보존 통합 번들의 Git blob은 `95587d65fad2ca6e2f60fe123edc4539e65c7d2b`, SHA-256은 `68b6b12c9c236ffaf32f2fa91edcb3e27f2cf2141ade3fec220aeaa498e2e861`이다. 분리 작업에서 당시 설치본과 해시를 다시 대조하지 않았으며 첫 회차의 빌드는 기록된 크기(3,895,286 B)로만 식별한다.

**2026-11-28 1회차 통합 빌드(3,895,286 B):** 기존 posting checkpoint를 보존한 실앱 리로드가 47.005초 이내 `ready`, 첫 일반 질의 수락 47.299초였다. 지정 5문항의 저장·재열기는 5/5, 생성 검증은 4/5다. Q3의 부족 facet은 제한된 직접 탐색 이후에도 미지지였고 생성·교정이 각각 validator에서 거절됐다. `history-review`는 관측된 실패를 포함한 미완료이고, 독립 사람 평가 부재로 참조 대비 의미는 미판정이다.

**2026-11-28 2회차 통합 빌드(3,913,389 B):** 실제 plugin reload first-ready는 45.541초, 첫 일반 질의 수락 45.818초였다. 지정 비교 질문은 독립 재발견·현재 본문을 거친 양측 출처 [1,4]로 양쪽을 명시해 종합했고, 이 빌드의 5/5가 교정 없이 validator를 통과하여 자동 저장·기록 목록 재열기를 마쳤다. 독립 의미 평가는 미관측이다. 단일 항목의 참조 조건 보존도 문자열/형식 성공만으로 판정하지 않았다.

| 날짜·커밋 | 확인 범위 | 명령·종료 상태·반복 횟수 | 차단·한계 |
| --- | --- | --- | --- |
| 2026-11-28 · `964a82f` 기반 미커밋 트리 | production 3,913,389 B, 실앱 지정 Q3 우선 5건·양측 지지·검증된 생성 5/5·기존 기록 34건 보존·저장 인용 행 15/15·인라인 링크 41/41 | `npm run build` exit 0, `history-review check` exit 2(사람 평가 없음·관측 실패 없음), `quality:local` exit 1(단위 4,060 passed/2 skipped·Rust 747 passed/2 ignored·계약/review 통과 후 vault-leak 단계), 별도 diff check exit 0 | 누출 검사 11행 구절은 해당 파일의 HEAD에도 있고 검사 대상 볼트 텍스트의 일치는 저장 채팅에서만 확인됨. 정책·원장 보존, 누출 gate 미통과. 의미 품질·전수 recall·모델별 연속 3회 미입증 |
| 2026-11-28 · `964a82f` 기반 작업 트리 | 249,607 청크 ACK·기존 posting 보존, 첫 일반 UI 수락, 새 기록 5건 재열기·동일 턴 7단계 관측·저장 인용의 원문 절대 행 42/42, 기존 21건 보존 | `npm run build` exit 0(검색 게이트 15/15, 3,895,286 B), `npm run quality:local` exit 0, 지정 리로드 1회·Q3 우선 지정 5건, `history-review check` exit 2 | 프로세스 콜드 스타트 아님. 재생 delta 0, 의미 검색 비활성. 후속 검색 제한 5건, Q3 근거만 표시. 독립 의미 평가·모델별 연속 3회 미입증 |
| 2026-11-27 · 작업 트리 | 문단 ID 선택지·고정 필드 사유, 설치 SHA-256 10/10, 일반 생성 답변·저장·기록 재열기 5/5, 기존 11개 보존, 저장 인용 절대 행 11/11 | `npm run build` exit 0(3,837,965 bytes), 대상 Vitest 301개·Rust 회귀 통과, 리로드 1회·전송 5회·교정 2회 | Q3 facet 출처 불일치와 Q4 text 오류는 1회 교정으로 각각 회복. 의미 검색 비활성. 참조 대비 의미 충실도·전체 회수·다른 모델은 미입증 |
| 2026-11-27 · 작업 트리 | 최종 생성·교정 지침과 facet 출처 투영, 지정 테스트 볼트 설치 SHA-256 10/10, 일반 채팅 저장·재열기 5/5·기존 6개 보존, 저장 인용 절대 행 대조 12/12 | `npm run build`(검색 게이트 15/15), 최종 `node esbuild.config.mjs production` exit 0(3,834,340 bytes), 대상 Vitest 378개 통과, 리로드 1회·전송 5회 | 의미 검색 비활성, 생성 답변 4/5. 1건은 `invalid-sources` → `invalid-covers` 후 검증 근거만 표시. 의미 충실도·전체 회수·모델별 반복 미입증 |
| 2026-11-27 · `ea2f0f7` 기반 작업 트리 | Windows production 번들, 지정 테스트 볼트에 한해 설치 자산 10개 SHA-256·실행 본문 대조, 단일 일반 채팅 전송·자동 저장·기록 재열기, 기존 기록 5개 보존 | `npm run build` exit 0(검색 게이트 15/15, 3,829,610 bytes), `npm run quality:loop` exit 0(합성 9/9), 플러그인 리로드 1회·실제 전송 1회 | BM25 복원 약 36분, 실제 응답·자동 저장 133초. 의미 검색 비활성. 제품 검증 인용 3개 중 독립 원문 행 일치 1개, 후속 4건 및 모델별 반복 미실행 |
| 2026-10-28 | 검토 coverage를 원문 검증 범위로 분리, 채택 근거 revision·contentHash 갱신, 결정적 열거, WASM 벡터 랭킹 실패의 TS 대체 폐쇄, 검색 없이·server-only 우선순위, 준비 중 부분 색인 context 차단, 대기 실패 뒤 전사 중복 방지, 진행 문구 작업 영역 분리, 생성물 DB·승인 경계 | `npm run quality:local` exit 0(전체 Vitest·lint·typecheck·Rust·review·leak), `rust:check` 538 passed·2 ignored(당시) | 실제 답변·전수 recall·모델별 3회·화면 검수 미완료 |
| 2026-10-28 | 검색 화면 `preparing` 부분 색인 차단·`degraded` 한정 허용·ready에서 1회 재개, 채팅 readiness 백엔드 독립, 로컬 질의 분해, 검색 선택·벡터 저장소 mutation·통계·lookup·RAG 상태·pending 파일 계획의 TS 계산 fallback 제거 | `npm run lint`·`npm run typecheck` exit 0, `test` 통과(Vitest 2,433 passed·1 skipped, i18n·UX gate·quality eval 187 passed(당시)·vault leak), 선행 `quality:local` Rust 538 passed·2 ignored(당시), preview Enter→submit 대기 등록·ready 재개 | facet 검색·집계의 단일 순회 미완료 |
| 2026-10-28 | 검토 예산 밖 `unreviewed` discovery 경로 최대 8개·8페이지 재검색, 현재 원문 검증 통과 근거만 Rust 병합, 필터는 정책 재조회가 있을 때만, 재조회·검색 실패·취소는 기존 근거 유지, 넓힌 검토 범위를 총계·진행·안내에 반영 | `npm run typecheck`·`npx eslint` exit 0(당시), `npx vitest run src/agent/indexed-vault-review.test.ts src/agent/indexed-vault-followup.test.ts src/agent/indexed-vault-search.test.ts` 125 passed(2026-10-28 재측정), `git diff --check` exit 0 | 9번째 페이지 밖 단서·실제 답변 품질·전체 recall |
| 2026-10-28 | 색인 중단 상태를 런타임 재초기화·설정 저장·스냅샷 복구 뒤에도 유지, 명시적 재색인·재개에서만 재시작, 재개 버튼은 성능 보호 일시정지가 아니어도 활성, `?readiness=preparing\|degraded`·`?docs=0`·`?noindex=1` 표시, `degraded` 성공 응답을 버리던 경로 수정 | `vitest main.test.ts src/settings.test.ts src/search/view.test.ts` 통과, `preview:build` exit 0, 스크린샷 4장 확인 | 실제 Obsidian 앱·좁은 폭 전체 조합·다크 테마 |
| 2026-10-28 | BM25 facet 검색·term 집계를 `batch_search_and_aggregate_json` 1회로 통합, 허용 경로 1회 전송·선택 chunk 주소 1회 읽기, 실패·상한 초과 시 기존 경로 fallback, vector 후보는 facet별 호출 유지 | batch 1회·개별 `queryBm25Exhaustive`·`queryMatchInventory` 0회 테스트 고정, 20-term·null fallback 회귀, batch·개별 점수·순위·집계 동등 회귀, 합성 2,000문서 개별 6회 median 14.05ms·batch 1회 15.25ms | worker bridge·제품 p95 미측정, 지연 개선 미입증, 실제 답변·전체 recall 미재측정 |
| 2026-10-28 | README의 '허용 색인 전체 본문 전송' 설명을 엔진 선별·현재 원문 검증 dossier 경로로 정정 | 문서 변경(코드 검사 없음) | 전체 재작성 없이 전송 범위만 수정, 다른 제품 설명 보존 |
| 2026-10-28 | 스펙·코드 정합성 점검: 15개 노드의 코드 참조·링크·식별자 확인, 검사기 경로 분류 서술 보정, 검증 상태 서사를 표로 압축, 스펙이 참조하지 않는 WASM wire wrapper 10개와 전용 타입 11개·검증기 8개·import 10줄 제거 | `npm run quality:local` exit 0(lint·typecheck·test:unit·rust:check·review·leak·diff), `npm run test:contracts` 별도 실행 통과, `npx eslint` exit 0 | 실제 답변·전수 recall·화면 검수 미포함, WASM glue의 대응 export는 남음 |
| 2026-10-28 `3231a6b`·`f2d7a7e` | 사용하지 않는 vault research agent와 chat-quality case 제거. `research-agent.test.ts`의 `it(` 선언 22건이 사라지고 `it.each`는 유지됐으며, chat-quality `whole-vault-user-format` case 1건이 빠지고 `indexed-vault-review.test.ts`에 1건이 추가됐다 | 당시 전면 재실행 기록은 없다. 제거 22건·추가 1건(순 −21)이 관측 감소(2,503→2,482)와 일치하고 quality eval은 187→186이다 | 제거된 실행 에이전트의 회귀 근거는 남기지 않음(의도 분류·진행 라벨만 유지) |
| 2026-10-29 | 공식 제공자 한도·잔액의 공통 조회·Rust 정규화·전역 30초 갱신, 설정 연결명과 채팅 선택 모델 옆 표시, 연결이 비어도 보이는 간격 입력, 실제 초 기반 표시 단위, 조회 불가·미지원·비활성·대기의 구분 | `npm run quality:local` exit 0(lint·typecheck·Vitest 2,605 passed·1 skipped·i18n·UX gate·quality eval 186 passed·Rust 568 passed·2 ignored·review·leak·diff), `npm run preview:build`·`npm run preview:verify` 15개 화면 통과, `npm run build` exit 0(main.js 4,959,439 / 5,000,000 bytes) | 실제 계정 한도 조회·현재 과금 상태·OpenCode Go 공개 잔액은 미검증, 합성 응답과 고정 뷰포트만 확인 |
| 2026-10-29 | 기존 구세대 색인 폐기의 설정 승인 경로를 스펙에 반영(런타임 변경 없음), facet별 엔진 호출 수 특성화와 batch 설계 기록, 실제 환경 검증 절차 추가 | `npm run quality:local` exit 0(lint·typecheck·test:unit·test:contracts·review·leak·diff), Vitest 2,483 passed·1 skipped·quality eval 186 passed | mock 엔진 호출 수만 확인. 실제 제공자·색인 순회·지연 계측, batch 구현, 실제 답변·전수 recall 검증은 미실행 |

표에서 커밋 해시가 없는 행은 당시 커밋 기록을 남기지 않았다.

**합성·구현 검증 통과:** 사용자 지정 범위와 집계 일치, 발견 원장·후속 조사·상위 k와 분리한 문서별 열거·100문서 합성 열거, 미완료·예산 제한·검토 완료 구분, 실제 진행·추론 요약·검증 후 게시·상세 접기, 준비 대기 질문 보존과 한 번 재개, 문서·구현 차이 판정.

**수정한 확인 결함:** 문자 예산 초과 구절 뒤 짧은 구절 선택 중단(`f79fc1b`), 문서 예산을 고유 경로가 아닌 청크 수로 계산한 `candidate_depth`(`759ad03`), BM25 작업자 순차 처리에서 미전송 요청에 timeout이 흐르던 계약(`93f3a36`), 번역 질의의 원래 주제 손실과 전체 원장 입력 예산 초과로 답변 호출이 건너뛰어지던 문제.

**남은 수용 경계:** 아래 필수 시나리오별 독립 자료·질문·범위·설정·대상 모델 고정, 최초 손실의 관측·수정, 제한 검토와 전체 열거의 실제 표시 대조, 대상 모델별 같은 조건의 연속 3회 합격은 미완료다. 실제 환경·화면과 최종 보존/종료 판정을 포함한 실행 순서는 ThinkRail TODO가 소유하며 이 문단을 별도 활성 대기열로 재실행하지 않는다.

**대기열 밖 잔여 한계:** vector 후보 단일 순회 미구현(계측·설계는 `vault-evidence`가 소유), worker bridge·제품 p95 미측정과 지연 개선 미입증(상태는 아래 보조 지표가, 목표는 `superpower-goals`가 소유), WASM glue에 남은 무소비 wire export 10개(이번 변경으로 TS 래퍼가 사라진 것이며 그 밖의 미소비 export는 이전부터 존재, `deterministic-core`), `cleanupStaleIndexedDbGenerations`는 미연결 도우미지만 승인 정리는 별도 경로로 이미 제공된다(`retrieval-index`).

**확인된 손실:** 추적 원문 3개가 초안에는 생성되지만 선택·병합·현재 원문 검증을 거친 dossier에 도달하지 않았다(재생 순위 38·76·1,273). 최초 손실 단계는 미확정이며 문서 예산 수정으로 후보 깊이·선택 문서 수가 늘었어도 미도달은 남았다. 최신 실제 답변도 참조 답안의 관계·조건/예외 설명에 미달했고 선택 모델의 연속 3회 합격은 없다. 다른 대상 모델은 미실행이다.

**전수 대조 범위:** 계획 용어 10개를 NFKC·Unicode 소문자·비중첩 부분 일치로 Markdown 현재 본문 10,605개와 대조해 1,711문서·9,269발생, 용어별 엔진 문서 집합의 누락·추가 0을 확인했다. 비Markdown 701개는 제외했고 제목·경로·중첩 청크·구간/발생 집계와 전체 시나리오·의미 확장은 이 대조의 범위가 아니다.

**보조 지표:** 검색 요청 수신 → dossier 준비 p95는 미측정이다. 전체 응답 완료 시간은 품질 판정에 쓰지 않는다.

**작업 대기열:** 남은 실행 항목은 ThinkRail TODO에 둔다. 세션이 바뀌면 이 절을 기준으로 대기열을 다시 만들고 완료·미완료 판정도 이 절과 대조한다.

## 필수 시나리오와 합격 항목

기준 단계에서 아래 시나리오를 자료·질문·범위·모델·설정과 함께 고정한다. 각 시나리오는 대상 모델별 동일 조건 실제 표시 답변 연속 3회로 판정하고, 문구 일치가 아니라 의미·근거·집계의 충족을 본다. 실행하지 않은 모델·시나리오는 미검증으로 남긴다.

| 시나리오 | 합격 항목 |
| --- | --- |
| 기준선·참조 답안 | 핵심 설명·하위 질문·비교·관계·조건/예외·자료 누락·집계·인용이 참조 답안과 동등 이상. 표현 동일성은 요구하지 않는다 |
| 전수검색 발견 | 같은 접근·제외·정규화 조건의 Ctrl+F 문서 집합과 누락·추가 0. 본문/제목, 문서/청크, 현재 원문/색인 단위를 명시하고 구간·발생은 별도 집계한다 |
| 범위 제한 | 폴더·태그 범위 밖 수치·경로 0, 범위 안 총계와 열거가 같은 정의를 사용하며 실제 최종 표시와 일치한다 |
| 예산 초과 열거·후속 조사 | 확인된 문서의 누락·중복·개수 불일치 0, 예산 밖 단서의 추적·페이지 조회 가능, 실패·취소·새 근거 없음에 유한한 종료 |
| 미완료·실패 | 부분 읽기·읽기 실패가 성공·자료 없음·단순 예산 제한으로 약화되지 않고 상태·수치·사유가 끝까지 유지된다 |
| 준비 대기·재개 | 준비 완료 후 중복 없이 한 번 재개, 취소·세션/설정 변경·실패·timeout에서 늦은 재개 차단, 안내 문구가 실제 동작과 일치한다 |
| 다국어·관계/조건 | 한국어 질의로 한·영(가능하면 라틴) 문서 의미 회수, 문서 간 관계·조건/예외가 최종 답변에 보존된다 |

## 실제 환경 검증 절차

실제 표시 답변 검증에는 실행 중인 Obsidian, 플러그인이 설치되고 색인이 준비된 대상 볼트, 사용자가 선택한 제공자 인증·모델이 필요하다. 저장소와 Chrome만으로는 이 전제를 충족하지 않는다. 에이전트 환경에서도 전제와 승인된 접근 경로가 확인되면 실행할 수 있으므로, 미확인을 실행 불가로 단정하지 않고 환경별 차단 사유를 기록한다. 합성·오프라인 계약 검사만으로 표시 답변·전수 recall을 판정하지 않는다.

**전제.** 실제 Obsidian 데스크톱과 사용자 볼트(또는 Git 제외 테스트 볼트), 사용자가 선택한 제공자 인증과 모델, 그리고 품질 요구·필수 시나리오에 따라 고정한 독립 기준선. 현재 실행 순서와 마지막 실제 검증으로의 이관은 ThinkRail TODO에서 확인한다. 데이터 취급·경로·색인 제외·생성물 정리·잔존 확인은 `## 테스트 볼트와 평가 데이터`가 소유한다.

**절차.**
1. `## 필수 시나리오와 합격 항목`에 따라 시나리오별 독립 기준선을 고정하고 앱·볼트·모델의 실행 준비 여부를 확인한다. 현재 ThinkRail TODO에 보존된 사용자 순서·보류를 따른다.
2. 전수검색 기준 집합은 `## 필수 시나리오와 합격 항목`의 '전수검색 발견' 항목에 따라 확정하고 집합·구간·발생을 기록한다.
3. 같은 조건으로 채팅 표시 답변을 받아 엔진 발견·dossier·최종 답변을 참조 답안과 대조하고 최초 손실 단계를 기록한다.
4. 반복 횟수·모델별 판정은 `## 필수 시나리오와 합격 항목`을 따른다.
5. 나머지 시나리오의 표시 답변도 같은 방식으로 대조한다. 미완료·예산 제한·읽기 실패·준비 대기·재개의 실제 앱·좁은 폭·다크 테마를 포함하며 화면 검수는 `## 검증 범위와 게이트`의 UI 계약을 따른다.

**오프라인 보조 명령.** `npm run search:eval`·`npm run search:bench`는 합성 평가, `npm run chat:quality-eval`은 오프라인 계약 검사다. 이 결과를 표시 답변 합격으로 승격하지 않는다.

**화면 보조 명령.** `npm run preview:verify`는 Chrome·기준 자산 캐시·최신 preview 번들이 필요하다. 캐시가 없으면 실제 Obsidian CLI를 사용하는 `npm run preview:prepare`가 필요하며 검증 명령도 이를 자동 시도한다. 제품 코드 변경 뒤에는 `npm run preview:build`를 선행한다. 현재 CI에는 포함되지 않고, 합성 화면 검수를 실제 앱·모델 답변 검수로 대신하지 않는다.

**실제 앱 보조 명령.** `npm run test:e2e:vault -- --vault <vault>`는 실행 중인 Obsidian, 플러그인 설치·색인 완료 볼트, 구성된 검색 경로가 필요하다. 기본 CLI는 macOS 앱 내부의 `obsidian-cli`이며 다른 위치는 `--obsidian-cli`로 지정한다. 대상 볼트는 명시해 자동 선택을 피한다. 이 하네스는 자기 문서 회수 집계이며 gold label이 없으므로 전수검색·표시 답변 합격 증거가 아니다. 산출물 취급은 위 데이터 보호 정본을 따른다.

### 지정 5문항 기록·의미·턴 추적 종료 게이트

이 절은 **별도 승인을 받은 다음 실행**의 수동 UI 절차다. `test:e2e`의 제품 여정, `test:e2e:vault`의 자기 문서 회수, `quality:loop:vault`의 engine-only 대조 중 어느 것도 대신할 수 없다. 기존 로컬 history 하네스의 전송/진행 관측 → 저장 목록 가시성 → 재열기 → 진단/보고 경계를 따르되 개인 loader·볼트 설정·기존 결과를 복사하거나 재생하지 않는다. 자동 수집이 없다면 관측자가 같은 절차를 직접 수행한다.

1. 앱을 열기 전 `git check-ignore .thinkrail/context/_history-review/probe`로 제외를 확인한다. 저장소 루트에서 `node scripts/search-eval/history-review.mjs init`으로 **새 회차**를 만들고 출력 UUID를 보관한다. `.thinkrail/context/_history-review/<UUID>/observations.json`은 실행 관측자, 같은 위치 `review.json`은 독립 사람 평가자가 작성한다(UTF-8). case 번호·receipt는 이 회차의 지정 문항과 새 기록을 1:1로 연결하는 별칭이다. 식별 원문·제목·경로·질답·trace JSON·스크린샷은 옮기지 않는다. 판정 근거도 비식별 요약만 남긴다.
2. 지정 Obsidian/볼트·설치 빌드·선택 모델/설정·자동 저장·색인 serving ready를 확인한다. 기존 기록·탭·설정·평가 자료의 보존 기준을 잡는다. 독립 참조와 사용자 답안을 먼저 고정하고 평가 자료는 검색·첨부·인용에서 제외한다. 승인된 설치에서 **같은 턴의 실제 Superpower Inside trace**를 관찰할 수 있는지 확인한다. 개발용 저장 `Debug Trace`는 배포 빌드에서 비활성이다. 승인 없이 빌드·설정·모델을 바꾸거나 replay/집계 로그로 대체하지 않는다. 전제가 없으면 미완료다.
3. Q1부터 Q5까지 각각 **새 세션**, 지정 질문만 일반 작성창에 넣고 전송 버튼으로 한 번 전송한다. 내부 검색 API·모의 응답·답안 주입 금지. 각 응답의 최종 상태·표시 본문·인용을 확인하고 자동 저장을 기다린다. 기존 기록이 아닌 서로 다른 새 기록 5개인지 확인한 뒤 각 세션을 떠나 **실제 기록 목록의 해당 행을 클릭**해 질문/사용자 메시지·최종 본문·상태·인용이 전송 직후와 같은지 확인한다. 실행 중 표시나 파일 존재만으로 체크하지 않는다. 오류·취소·근거만 표시된 경우 `terminalAnswer` 성공이 아니다. 품질 실패 한 건으로 나머지 문항의 진단을 생략하지 않는다. 종료 시 활성 턴 0과 기존 자료/설정/탭 보존까지 관측한다. `checks`와 `ui`는 직접 확인한 성공/실패만 true/false, 미관측은 null이다.
4. 매번 실제 세션과 assistant message ID·질문·회차를 원위치에서 대조하고 일치할 때만 `sameTurnTrace`를 확인한다. 각 `trace` 행은 계획/질의 → 검색 후보·예산/누락 → 선택·후속 탐색 → 현재 원문 검증 → 모델로 전달한 dossier → 최종 생성·교정/오류 → 재열린 표시·인용 순서다. 각 경계에서 필요한 사실·관계·조건이 **입력에서 결과로 보존됐는지** 분석한다. `analysis`에 관측한 단계 신호(예: 후보/채택/검증 수, 생략·제한 사유, 요청/재시도 수, 단계별 지연이 있으면 그 값)와 전달/손실 근거를 비식별로 설명하고 `finding`에 `preserved`/`loss`를 기록한다. 선택 단계가 불필요했다면 생략이 정당하고 정보가 보존된 실제 증거가 필요하다. 잘린 trace·없는 이벤트·전체 소요 시간·최종 인용 수만으로 미관측 경계를 추정하지 않는다(null). 최초 손실 전 단계가 비면 최초 손실은 unknown이다.
5. **독립 사람 평가자**가 각 receipt에 대응하는 실제 재열린 답변과 출처를 읽고 고정 참조(`reference`) 및 사용자 답안(`userAnswer`)과 **각각** 비교한다. 하위 질문, 사실·수치, 비교·관계, 조건·예외, 인용의 주장 지지와 범위/근거 없는 추가를 항목별 `meets`/`misses`로 적고 `rationale` 두 칸에 차이와 이유를 요약한다. 해당 요구가 없는 축은 부당한 추가도 없는지 확인해 이유를 남긴다. 단어 겹침·인용 개수·모델 자기 채점은 대체물이 아니다. 사람이 직접 대조했을 때만 `independentHuman: true`. 기준선 또는 입력이 없으면 null을 유지한다.
6. `node scripts/search-eval/history-review.mjs check <UUID>` (꺾쇠 대신 회차 값). 이 명령은 두 로컬 원장만 읽으며 앱이나 모델을 호출하지 않는다. exit 0 = **해당 1회차** 전 항목 관측·합격, 1 = 전 항목 관측했으나 실패, 2 = 입력 오류·미관측·독립 평가 부재 등 미완료. 미완료는 확인된 실패를 상쇄하지 않는다. 원장은 사람이 서명하는 체크리스트이지 관측 진위나 독립성을 인증하는 시스템이 아니다. 대상 모델별 연속 3회 기준은 별도이며 회차를 재사용하지 않는다.

**기록.** 결과는 `## 검증 상태와 이력` 표의 새 행에, 현행 판정은 그 절의 현재 checkpoint 문단에 함께 갱신한다.

## 세션 인수인계

새 세션은 대화 TODO가 아니라 스펙에서 작업을 재구성한다. 순서는 다음과 같다.

1. [품질 요구](goal-and-requirements.md#품질-요구)와 이 문서의 검증 상태·시나리오·[실제 환경 검증 절차](#실제-환경-검증-절차), `vault-evidence`의 답변 총실도 절, 관련 모듈 SPEC을 읽는다.
2. 현재 ThinkRail TODO를 읽어 사용자의 순서·보류·최종 검증 이관을 보존하고 각 단계의 소유 절·합격 항목과 대조한다. 과거 문서의 실행 기록을 새 활성 할 일로 재생성하지 않는다.
3. 로컬 검증 자료(`.test-vault`의 QA·참조 답안)는 사용자 로컬에서만 읽고 원문·문서명·질의·답변을 스펙·커밋·기억에 복제하지 않는다. 모델 선택이 없으면 사용자에게 확인하며 임의 교체하지 않는다.
4. 작업·판정은 이 문서의 시나리오와 상태 절을 기준으로 하고, 새 draft 노드 승격·기준 완화·미검증 완료 처리를 하지 않는다.
5. 종료 시 검증 상태 절에 날짜·커밋(있으면)·확인 범위·명령·종료 상태·반복 횟수·차단·한계를 갱신하고 완료된 TODO 단계만 닫는다.

## 테스트 볼트와 평가 데이터

테스트 볼트는 언제든 내용이 교체될 수 있는 로컬 자료다. 특정 문서·질의·정답을 제품 규칙이나 회귀 fixture로 고정하지 않는다. 원문·문서명·경로·고유 표현·관계·질의·기대 답변·임베딩과 이를 복원할 수 있는 변형을 코드·테스트·snapshot·공유 문서·커밋·기억에 복제하지 않는다. 커밋할 회귀 자료는 볼트와 독립적인 합성 데이터로 만들고 다른 내용·언어에서도 같은 계약을 확인한다.

공개 검색 연구는 전체 코퍼스의 고정 버전·권리·정답 신뢰도·개발/보류 구분을 기록하고 같은 엔진 경로·질의·조건에서 기준선과 변경 후 품질·누락·지연·자원을 비교한다. 평가 코드·질의·정답·기록은 Git 제외 벤치마크 공간에 격리하고 색인하지 않는다. 검색 대상 코퍼스의 색인과 Git 제외는 별도 정책이다. 합성 회귀를 실제 데이터의 성능 증거로 쓰지 않는다.

실제 볼트 검증은 사용자 요청 또는 실제 볼트에서만 재현되는 문제에 필요한 범위로 제한한다. 임시 스크립트·복사본·로그·스크린샷·임베딩·캐시는 생성 전 git check-ignore로 확인한 별도 경로에 둔다. 외부 도구·채팅·공유 보고서에 식별 원문을 출력하지 않는다. 성공·실패와 무관하게 이번 생성물만 정리하고 잔존 여부를 확인한다. 기존 볼트·설정·색인·저장 세션은 보존하며 정리 불가·보존 미확인은 미완료로 보고한다.

`quality:loop`는 실제 제품의 collect → 현재 원문 심사 → engine-only dossier를 독립 합성 원장과 대조한다. `quality:loop:vault`는 명시한 앱/볼트의 전용 serving-only lexical lease와 메모리에 있는 독립 gold만 받는다. 앱 사전 검사에서 검증된 gold 평가 필드의 불변 메모리 사본만 평가한다. 번들 빌드 직후, lease 취득 전후, 원문 읽기 전, 평가 완료·보고서 게시 직전에 배열 교체나 평가 필드 변경이 관측되면 `independent-gold-required`로 차단하고 획득한 lease는 반납한다. 사본은 앱 밖으로 내보내지 않는다. 해당 API·lease·gold가 없으면 차단하며 일반 검색 포트·초기화·다른 모델·별도 기준선으로 대신하지 않는다. 준비된 의미 벡터가 없는 평가를 의미 품질 합격으로 쓰지 않는다.

독립 oracle은 NFKC·Unicode 소문자·비중첩 부분 일치의 문서·행 구간·발생과 수작업 정보 ID의 전달 보존을 구분한다. quote와 실제 인접 문맥의 연속 원문·절대 행을 검증하고, 같은 행의 뒤쪽 반복도 전달되었으면 회수로 센다. 유일 정보 회수·중복·잡음·전달 byte·전체 dossier byte는 별도다. 필수 사실·관계·조건·예외·상충 양측과 제외 누출 실패를 평균이나 밀도로 상쇄하지 않는다. 필수 정보를 잃은 기준선과는 밀도 개선을 인증하지 않으며 미관측 capped recall은 최종 recall의 복제 대신 null이다. 최초 손실은 관측한 앞 실패까지만 판정하고 그보다 앞 단계가 미관측이면 unknown으로 남긴다. BM25 exact-token 집계와 이 부분문자열 기준선은 다른 일치 정의다. literal 평가에는 실제 제품 원문 원장의 별도 총계와 전체 비동기 페이지를 사용하고 문서·행·비중첩 발생·정규화 위치·누락/중복/추가 페이지를 독립 oracle과 대조한다. 수작업 필수 term의 존재 확인과 별개로 summary에 선언된 모든 planner·중복 정규화 needle index를 대조하며 미선언 index도 거부한다. 검토 대표 페이지 한도나 token 총계를 전수 대조로 대신하지 않는다. 평가용 protocol fixture는 VM·출력/취소 회귀의 테스트 대역일 뿐 실제 제품 검사에 정답이나 집계로 주입하지 않는다.

provider·embedding·금지 통신 시도는 예외가 내부에서 흡수되어도 원장으로 실패시킨다. 신뢰한 평가 번들과 MAIN lexical lease의 경계 안에서 로컬 source 문자열 완전 일치 또는 설치 PDF worker의 size/SHA-256 일치로 만든 blob URL만 계산 worker로 허용한다. 임의 blob·원격 worker·누락 자산 다운로드·모델 worker로 넓히지 않으며 앱 전역을 monkeypatch하지 않는다. 이는 임의 JS·호스트 lease·별도 realm 전체에 대한 보안 sandbox 보장이 아니다. 앱 내부 중간 파일과 최종 보고서 모두 쓰기 전에 같은 항목·고정 문자열 허용 목록을 통과해야 하며 원문·질의·인용·개인 경로·임베딩·raw 오류를 쓰지 않는다. 공개 main의 실패 회귀도 실제 사용자 보고서를 덮어쓰지 않는 메모리 쓰기로 격리한다.

볼트 유출 검사는 단위 테스트와 별도 단계로 격리하되 npm test와 quality:local에 항상 포함한다. 볼트가 없으면 생략하고 내용 없이 파일 위치만 출력한다. 추적 파일과 미스테이징 새 파일도 검사하며 src/i18n.ts의 사용자 정본 문구는 위반으로 간주하지 않는다. 이미 공개된 법적 고지와 볼트 자료가 겹쳐 생기는 오탐은 고정 등록한 `THIRD_PARTY_NOTICES.md`의 Git HEAD 기준선에 한해 구분한다. 그 기준선에 있는 파일명·구절만 기존 공개 정보로 취급하고, 현재 스테이징·작업 파일이나 볼트 본문으로 예외를 자동 확장하지 않는다. 같은 이름의 문서나 고지 파일에 새 비공개 구절이 추가되면 계속 탐지하며, 기준선이 없으면 기존 탐지를 유지한다. 검사 통과는 실제 답변 품질의 증거가 아니다.

## 저장소 생성물 경계

원본 코드·자료·설정은 기존 위치를 유지한다. 현재와 앞으로 추가되는 재다운로드·재생성 가능한 파일 및 폐기 가능한 임시 파일의 기본 저장 경계는 `.local/`이다. 다운로드한 모델·라이브러리·실행 자산, worker·런타임·WASM·번들·생성 코드, 컴파일 결과·캐시·진단 출력·검증 중간물은 기존 파일인지 새 파일인지와 무관하게 이 경계를 따른다. 계산 glue·내장 데이터·worker 소스는 `.local/generated`, 설치·배포 파일과 개발 설치에 따르는 다운로드는 `.local/plugin`, 재사용 가능한 컴파일·검증 캐시는 `.local/cache`에 둔다. 위치 통합은 Git 추적 해제와 별개이며, 태그 시 재빌드하지 않는 배포 계약에 필요한 기존 생성물만 정확한 허용 목록으로 추적한다. 설치용 manifest·CSS·법적 고지는 루트 정본에서 복사하고 캐시·모델 다운로드·플러그인 설정은 추적하지 않는다.

새 다운로드·생성·캐시 경로를 도입하거나 `.gitignore`에 항목을 추가할 때도 먼저 이 경계 안에 배치한다. 다른 위치는 외부 도구의 필수 경로·호환성·격리 등 구체적인 이유가 있을 때만 예외로 허용하며, 그 이유와 적용 범위를 소유 스펙에 기록한다. 기존 하드코딩이나 과거 관례만으로 예외를 늘리지 않는다. 사용자에게 보여주는 보고서·캡처·목업은 호스트가 정한 `.thinkrail/context/`를 사용한다. 설치된 사용자 플러그인의 런타임 저장 위치는 사용자 설치 디렉터리이며, 저장소 정리만으로 이를 이전하지 않는다.

현재 예외는 표준 모듈 탐색을 사용하는 `node_modules`, Git·에이전트 도구의 관리 경로, 사용자가 제외한 테스트 볼트다. `.gitignore` 포함 여부만으로 삭제 가능성을 판정하지 않는다. 원본 자료·비밀·인증정보·개인 상태·모델 삭제 표식은 재생성 가능한 캐시가 아니므로 보존한다. 삭제 후 재생성 검증은 명시한 대상만 지우며, 의존성 다운로드 준비와 오프라인 검증을 분리한다. 기존 테스트 볼트 연결 변경은 별도 승인 없이 수행하지 않는다.

## 검증 범위와 게이트

저장소의 개발·검증 명령은 Windows·macOS·Linux 공통 Node 진입점을 우선하며, 작업에 필요한 외부 도구는 호스트에서 직접 실행한다. OS 고유 런타임이나 앱 연동이 불가피한 경우만 플랫폼별로 분기하고 지원 범위와 실패 조건을 명시한다. Windows에서 npm 같은 Node 도구는 `.cmd`용 셸 문자열을 조합하지 않고 Node로 CLI 진입점을 실행해 인자·종료 상태를 보존한다. 테스트의 OS 경로·URL 변환은 실제 실행 환경을 따른다.

Windows Rust 빌드·검사는 호스트의 MSVC C++ Build Tools·Windows SDK와 프로젝트가 고정한 rustup MSVC toolchain을 직접 사용한다. WSL로 대체하거나 셸의 전역 rustup 기본값에 의존하지 않는다. WASM 생성에는 프로젝트의 wasm-bindgen crate와 동일한 버전의 CLI가 필요하며 불일치 시 컴파일·생성물 갱신 전에 중단한다. Rust 보안 도구 설치는 실행 파일을 찾을 수 없거나 `--version`이 실패하면 다음 도구로 넘어가지 않고, 버전 검사 실패의 종료 코드를 호출자에게 그대로 전달한다.

기능·버그 수정·리팩터링은 회귀 테스트를 먼저 추가하거나 확장한다. lint 비활성·타입 검사 무시·as any·clippy allow·prettier-ignore로 실패를 우회하지 않는다. 설치된 의존성·생성물로 오프라인 검증하고 Rust는 --frozen을 사용한다. 의존성이 없으면 준비 필요로 실패하며 네트워크·모델 호출로 조용히 대체하지 않는다.

전체 unit에는 설치된 패키징 Ternlight WASM 모델을 실제 실행하는 smoke가 포함된다. 이는 외부 제공자 호출이나 사용자 선택 모델·실제 표시 답변의 품질 평가가 아니며 모델을 호출하지 않는 `quality:loop`와도 다르다. 로컬 검사 권한으로 모델 자산 준비·다운로드를 임의 추가하지 않는다. `npm run build`는 WASM·검색 gate 외에 Ternlight 자산 복사도 포함한다. `security:full`의 Rust 경로에는 toolchain 준비·비-frozen 명령·외부 보안 검사가 있으므로 frozen 로컬 검사와 같은 명령으로 취급하지 않는다. 이 경로의 권한·설치·네트워크 전제를 확인하지 않고 자동 실행하거나 통과로 기록하지 않는다.

quality:local은 HEAD 대비 스테이징·작업 파일·새 파일을 기준으로 필요한 검사를 고른다. CI는 --base로 실제 비교 커밋을 전달한다. TS는 lint → typecheck → `test:unit`을 실행하고, `src/chat/`·`src/search/`·`src/i18n.ts`·CSS·채팅 UX fixture 변경은 `test:contracts`(i18n·채팅 UX·오프라인 계약)를 추가한다. 스크립트/CSS/CI는 관련 계약, Rust/WASM 경계는 TS 및 Rust fmt·clippy·tests를 확인한다. 문서·설명·버전만 바꾸면 community review·볼트 유출·diff 및 링크·명령을 확인하고 변경 없는 Rust·성능·온라인 보안·Patina를 강제하지 않는다. `.md`만 바뀌면 community review·볼트 유출·diff check가 선택되고, `design.md`는 preview 검수 안내를, `crates/` 아래 명세는 TS·Rust 검사를, `tests/fixtures/`는 `test:unit`을(`chat-ux/`는 `test:contracts`도) 추가로 선택한다. 이 선택은 게이트를 완화하는 근거가 아니다.

의존성·보안 정책 변경의 CI와 수동 검사는 security:full을 사용한다. dev 개발 변경은 로컬 quality:local로 변경 범위를 검사하고, dev로 가는 기능 PR이 있으면 CI도 같은 변경 범위를 검사한다. main으로 가는 릴리스 PR은 security:full 전체 검사를 실행한다. 태그 릴리스 workflow는 dev→main squash merge·버전·자산을 검증한 뒤 초안 Release를 만들며 전체 테스트를 중복 실행하지 않는다. 문서만 바뀌면 도구 설치·코드 검사도 생략한다. 이전 PR 실행은 새 커밋에서 취소한다. security:full의 기존 순서·측정 데이터·임계값·제외 정책을 유지한다.

UI/DOM/CSS/카피 배치·상태·모션·접근성 변경은 구조 테스트와 community review 외에 `npm run preview:verify`의 헤드리스 Chrome 고정 뷰포트 스크린샷과 DOM 계약을 직접 확인한다. 정상·빈 상태·접기/펼치기·오류·disabled·진행·좁은 폭·테마·focus·대비를 포함한다. 네이티브 앱의 마우스·타이핑 자동화는 금지하며 CLI·코드·로그를 사용한다.

`npm run preview:verify`가 설치된 Obsidian CSS·자산·합성 Markdown을 기준으로 Chrome을 헤드리스 실행해 여러 상태·뷰포트의 DOM 계약을 확인하고 PNG를 `.thinkrail/context/screens/obsidian-preview/`에 남긴다. `npm run preview:prepare`는 기준 자산을 준비하고 `npm run preview`는 수동 확인 서버를 실행한다. 제품 코드 변경 뒤 `preview:build`로 갱신한다. 기본 테마를 수제 CSS로 대체하지 않으며 자산은 Git 제외 `.local/cache/preview/`에만 보관한다. 상호작용이 필요할 때만 연결된 브라우저 도구나 Chrome을 사용하고 Playwright 자동화는 최후 수단으로 둔다. 촬영 불가는 미완료로 명시한다.

검색의 실제품질 합격 기준은 `superpower-goals`의 품질 요구와 이 문서의 게이트·검증 상태 절이, 배포·문구 검사는 `release-contract`가 소유한다. 완료 보고는 실제 명령·종료 상태·한계를 기록하며 같은 변경을 커밋·푸시만을 이유로 반복 검사하지 않는다. 커밋 요청은 커밋만 수행하고 푸시는 별도 요청이 있을 때만 한다. 절차와 권한은 루트 AGENTS에서 확인한다.
