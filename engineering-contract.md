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

2026-10-28 기준. 상세 실행 서사는 남기지 않고 날짜·커밋·일반 계약·명령·종료 상태·반복 횟수·차단 사유만 기록한다. 원문·문서명·질의·답변·개인 설정은 스펙·기억에 복제하지 않는다.

**현재 HEAD 재검증(2026-10-28):** `npx vitest run` 208개 파일·2,503개 테스트 통과(1 skipped), `npm run rust:check` 550 passed·2 ignored. 아래 날짜별 수치는 해당 실행 시점의 기록이며, 이번 재검증에도 실제 답변·전수 recall·모델별 3회·화면 검수는 포함하지 않았다.

**코드 경계 보강(2026-10-28):** 검토 coverage를 원문 검증 범위로 분리하고, 채택 근거의 현재 revision·contentHash를 갱신하며, 목록·개수 의도를 결정적으로 감지해 열거하고, WASM 벡터 랭킹 실패를 TS 대체 없이 닫았다. 검색 없이·server-only 우선순위, 준비 중 부분 색인 context 차단, 대기 실패 뒤 전사 중복 방지, 진행 문구 작업 영역 분리, 생성물 DB·승인 경계도 보강했다. `npm run quality:local` exit 0(전체 Vitest·i18n·UX gate·leak check·lint·typecheck·Rust)과 `npm run rust:check` 통과(538 passed·2 ignored, 당시 실행)를 확인했지만 실제 답변·전수 recall·모델별 3회·화면 검수는 여전히 미완료다.

**검색 준비·결정적 코어 보강(2026-10-28):** 검색 화면은 `preparing`에서 부분 색인 검색을 막고 제출 질의를 대기로 보존해 ready에서 한 번 재개하며, 확인된 제한(`degraded`)에서만 색인 범위 검색을 허용한다. 채팅 readiness는 키워드·벡터 중 하나라도 실제 사용 가능하면 다른 백엔드의 준비 실패만으로 검색을 막지 않는다. 질의 변형은 제공자 번역 호출 없이 로컬 질문 분해만 쓴다. 검색 선택·다양성, 벡터 저장소 mutation·통계·lookup, RAG 상태, pending 파일 계획의 TypeScript 계산 fallback을 제거해 WASM 실패 시 null·빈 결과·쓰기 중단으로 닫았다. `npm run lint`·`npm run typecheck` exit 0, `npm run test` 통과(Vitest 2,433 passed·1 skipped, i18n·UX gate·quality eval 187 passed·vault leak, 당시 실행), 선행 `npm run quality:local`에서 Rust 538 passed·2 ignored·review·diff check 통과(당시 실행). preview에서 실제 Enter→submit 대기 등록과 ready 재개도 확인했다. 검색 화면의 `preparing`·`degraded`·색인 없음·문서 0건 상태는 preview에서 확인했고, `degraded`에서 성공한 색인 범위 응답을 버리던 경로를 결과 표시로 고쳤다. 다만 facet별 검색·집계를 엔진 한 번·색인 한 순회로 통합하는 목표는 아직 미완료다.

**검토 예산 밖 discovery 조사 연결(2026-10-28):** 후속 질의 뒤 `unreviewed` discovery 경로를 최대 8개(최대 8페이지) 골라 같은 질문·로컬 질의 변형·원래 후보의 facet 귀속으로 다시 검색하고, 현재 원문 검증을 통과한 근거만 기존 dossier에 Rust로 병합했다. 필터가 있으면 현재 정책 재조회가 있을 때만 실행하며, 재조회·추가 검색 실패·취소는 기존 검증 근거를 유지한다. 추가 검토가 넓힌 검토 범위는 total·완료 진행·안내에 반영한다. `npm run typecheck`·`npx eslint` exit 0, `npx vitest run src/agent/indexed-vault-review.test.ts` 74 passed, 관련 후속·검색 테스트 121 passed, `git diff --check` exit 0. 9번째 페이지 밖 단서와 실제 답변 품질·전체 recall은 이번 검증 범위가 아니다.

**사용자 중단·검색 준비 화면 검수(2026-10-28):** 사용자가 색인을 중단하면 자동 복구 일시정지를 런타임 재초기화·설정 저장·스냅샷 복구 뒤에도 유지하고, 명시적 재색인·재개에서만 다시 시작한다. 설정 재개 버튼은 성능 보호 일시정지가 아니어도 사용자 중단 상태에서 활성화된다. 검색 화면은 preview `?readiness=preparing|degraded`·`?docs=0`·`?noindex=1`로 확인했고, `preparing`은 제출 질의를 대기로 유지했으며, `degraded`는 제한 라벨과 색인 범위 결과를 함께 표시했고, 색인 없음과 degraded·문서 0건은 검색을 비활성화했다. `degraded`에서 성공 응답을 사용 불가로 버리던 경로를 결과 표시로 수정했다. `npx vitest run main.test.ts src/settings.test.ts src/search/view.test.ts` 통과, `npm run preview:build` exit 0, 실제 스크린샷 4장 확인. 실제 Obsidian 앱·좁은 폭 전체 조합·다크 테마는 이번 캡처 범위가 아니다.

**BM25 facet batch 통합(2026-10-28):** 한 검색 계획의 BM25 facet 검색과 term 집계를 term 128개·입력 상한 안에서 `Bm25RuntimeIndex.batch_search_and_aggregate_json` 한 번의 worker 호출로 합치고, 허용 경로 목록은 payload에 한 번만 실으며 선택된 chunk의 원문 주소는 코퍼스에서 한 번만 읽는다. batch 실패·상한 초과 시 기존 facet별 검색·term 집계 경로로 되돌아가며, batch와 개별 호출의 점수·순위·집계가 같은지 Rust·BM25·query·검색 의존성 회귀에서 확인했다. 비교 계획에서 batch 호출 1회, 개별 `queryBm25Exhaustive`·`queryMatchInventory` 0회를 테스트로 고정했고, 20-term 계획과 null fallback도 회귀에 포함했다. 2,000문서 합성 fallback 런타임에서 개별 6회 호출 median 14.05ms, batch 1회 median 15.25ms였으며 worker bridge·제품 p95는 미측정이다. 호출 수와 결과 동등성은 확인했지만 실제 지연 개선은 아직 입증하지 않았다. vector 후보 임베딩·검색은 facet별 호출이 남아 있고, 실제 답변·전체 recall도 이번 변경에서 재측정하지 않았다.

**구현·합성 검증 통과:** 사용자 지정 범위와 집계 일치, 발견 원장·후속 조사·상위 k와 분리한 문서별 열거·100문서 합성 열거, 미완료·예산 제한·검토 완료 구분, 실제 진행·추론 요약·검증 후 게시·상세 접기, 준비 대기 질문 보존과 한 번 재개, 문서·구현 차이 판정.

**수정한 확인 결함:** 문자 예산 초과 구절 뒤 짧은 구절 선택 중단(`f79fc1b`), 문서 예산을 고유 경로가 아닌 청크 수로 계산한 `candidate_depth`(`759ad03`), BM25 작업자 순차 처리에서 미전송 요청에 timeout이 흐르던 계약(`93f3a36`), 번역 질의의 원래 주제 손실과 전체 원장 입력 예산 초과로 답변 호출이 건너뛰어지던 문제.

**남은 미완료(대기열 순서):**
1. 전체 전수검색 기준 집합과 필수 시나리오·대상 모델 범위를 확정한다.
2. 제한 범위와 실제 전체 열거의 최종 표시 답변을 대조한다.
3. 미완료·예산 제한·읽기 실패와 준비 대기·재개의 실제 화면을 확인한다.
4. 원문→dossier 최초 손실 단계를 확정하고 최소 수정한다(독립 합성 RED 선행).
5. 대상 모델별 동일 조건 실제 표시 답변 연속 3회 합격을 확인한다.
6. 회귀·보존·최종 종료를 판정한다.

**확인된 손실:** 추적 원문 3개가 초안에는 생성되지만 선택·병합·현재 원문 검증을 거친 dossier에 도달하지 않았다(재생 순위 38·76·1,273). 최초 손실 단계는 미확정이며 문서 예산 수정으로 후보 깊이·선택 문서 수가 늘었어도 미도달은 남았다. 최신 실제 답변도 참조 답안의 관계·조건/예외 설명에 미달했고 선택 모델의 연속 3회 합격은 없다. 다른 대상 모델은 미실행이다.

**전수 대조 범위:** 계획 용어 10개를 NFKC·Unicode 소문자·비중첩 부분 일치로 Markdown 현재 본문 10,605개와 대조해 1,711문서·9,269발생, 용어별 엔진 문서 집합의 누락·추가 0을 확인했다. 비Markdown 701개는 제외했고 제목·경로·중첩 청크·구간/발생 집계와 전체 시나리오·의미 확장은 이 대조의 범위가 아니다.

**보조 지표:** 검색 요청 수신 → dossier 준비 p95는 미측정이다. 전체 응답 완료 시간은 품질 판정에 쓰지 않는다.

**알려진 문서 차이:** README는 허용 색인 전체 본문을 provider로 보내는 과거 설명을 유지한다. 현행은 엔진 선별·현재 원문 검증 dossier 경로이며, 전체 재작성 승인 전까지 README를 보존하고 차이를 알려진 한계로 남긴다.

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

## 세션 인수인계

새 세션은 대화 TODO가 아니라 스펙에서 작업을 재구성한다. 순서는 다음과 같다.

1. [품질 요구](goal-and-requirements.md#품질-요구)와 이 문서의 검증 상태·시나리오, `vault-evidence`의 답변 총실도 절, 관련 모듈 SPEC을 읽는다.
2. 위 "남은 미완료(대기열 순서)"를 ThinkRail TODO 그룹으로 다시 만들고, 각 단계에 소유 절과 합격 항목을 연결한다.
3. 로컬 검증 자료(`.test-vault`의 QA·참조 답안)는 사용자 로컬에서만 읽고 원문·문서명·질의·답변을 스펙·커밋·기억에 복제하지 않는다. 모델 선택이 없으면 사용자에게 확인하며 임의 교체하지 않는다.
4. 작업·판정은 이 문서의 시나리오와 상태 절을 기준으로 하고, 새 draft 노드 승격·기준 완화·미검증 완료 처리를 하지 않는다.
5. 종료 시 검증 상태 절에 날짜·커밋·명령·종료 상태·반복 횟수·남은 한계를 갱신하고 완료된 TODO 단계만 닫는다.

## 테스트 볼트와 평가 데이터

테스트 볼트는 언제든 내용이 교체될 수 있는 로컬 자료다. 특정 문서·질의·정답을 제품 규칙이나 회귀 fixture로 고정하지 않는다. 원문·문서명·경로·고유 표현·관계·질의·기대 답변·임베딩과 이를 복원할 수 있는 변형을 코드·테스트·snapshot·공유 문서·커밋·기억에 복제하지 않는다. 커밋할 회귀 자료는 볼트와 독립적인 합성 데이터로 만들고 다른 내용·언어에서도 같은 계약을 확인한다.

공개 검색 연구는 전체 코퍼스의 고정 버전·권리·정답 신뢰도·개발/보류 구분을 기록하고 같은 엔진 경로·질의·조건에서 기준선과 변경 후 품질·누락·지연·자원을 비교한다. 평가 코드·질의·정답·기록은 Git 제외 벤치마크 공간에 격리하고 색인하지 않는다. 검색 대상 코퍼스의 색인과 Git 제외는 별도 정책이다. 합성 회귀를 실제 데이터의 성능 증거로 쓰지 않는다.

실제 볼트 검증은 사용자 요청 또는 실제 볼트에서만 재현되는 문제에 필요한 범위로 제한한다. 임시 스크립트·복사본·로그·스크린샷·임베딩·캐시는 생성 전 git check-ignore로 확인한 별도 경로에 둔다. 외부 도구·채팅·공유 보고서에 식별 원문을 출력하지 않는다. 성공·실패와 무관하게 이번 생성물만 정리하고 잔존 여부를 확인한다. 기존 볼트·설정·색인·저장 세션은 보존하며 정리 불가·보존 미확인은 미완료로 보고한다.

볼트 유출 검사는 단위 테스트와 별도 단계로 격리하되 npm test와 quality:local에 항상 포함한다. 볼트가 없으면 생략하고 내용 없이 파일 위치만 출력한다. 추적 파일과 미스테이징 새 파일도 검사하며 src/i18n.ts의 사용자 정본 문구는 위반으로 간주하지 않는다. 검사 통과는 실제 답변 품질의 증거가 아니다.

## 검증 범위와 게이트

기능·버그 수정·리팩터링은 회귀 테스트를 먼저 추가하거나 확장한다. lint 비활성·타입 검사 무시·as any·clippy allow·prettier-ignore로 실패를 우회하지 않는다. 설치된 의존성·생성물로 오프라인 검증하고 Rust는 --frozen을 사용한다. 의존성이 없으면 준비 필요로 실패하며 네트워크·모델 호출로 조용히 대체하지 않는다.

quality:local은 HEAD 대비 스테이징·작업 파일·새 파일을 기준으로 필요한 검사를 고른다. CI는 --base로 실제 비교 커밋을 전달한다. TS는 lint → typecheck → `test:unit`을 실행하고, `src/chat/`·`src/search/`·`src/i18n.ts`·CSS·채팅 UX fixture 변경은 `test:contracts`(i18n·채팅 UX·오프라인 계약)를 추가한다. 스크립트/CSS/CI는 관련 계약, Rust/WASM 경계는 TS 및 Rust fmt·clippy·tests를 확인한다. 문서·설명·버전만 바꾸면 community review·볼트 유출·diff 및 링크·명령을 확인하고 변경 없는 Rust·성능·온라인 보안·Patina를 강제하지 않는다. 현재 검사기의 경로 분류가 명세 파일에도 넓은 검사를 선택할 수 있으며 게이트를 완화하지 않는다.

의존성·보안 정책 변경의 CI와 수동 검사는 security:full을 사용한다. dev로 가는 기능 PR은 변경 범위만 검사하고, main으로 가는 릴리스 PR은 security:full 전체 검사를 실행한다. 태그 릴리스 workflow는 dev→main squash merge·버전·자산을 검증한 뒤 초안 Release를 만들며 전체 테스트를 중복 실행하지 않는다. 문서만 바뀌면 도구 설치·코드 검사도 생략한다. 이전 PR 실행은 새 커밋에서 취소한다. security:full의 기존 순서·측정 데이터·임계값·제외 정책을 유지한다.

UI/DOM/CSS/카피 배치·상태·모션·접근성 변경은 구조 테스트와 community review 외에 `npm run preview:verify`의 헤드리스 Chrome 고정 뷰포트 스크린샷과 DOM 계약을 직접 확인한다. 정상·빈 상태·접기/펼치기·오류·disabled·진행·좁은 폭·테마·focus·대비를 포함한다. 네이티브 앱의 마우스·타이핑 자동화는 금지하며 CLI·코드·로그를 사용한다.

`npm run preview:verify`가 설치된 Obsidian CSS·자산·합성 Markdown을 기준으로 Chrome을 헤드리스 실행해 여러 상태·뷰포트의 DOM 계약과 PNG를 `simulations/obsidian-preview/screens/`에 남긴다. `npm run preview:prepare`는 기준 자산을 준비하고 `npm run preview`는 수동 확인 서버를 실행한다. 제품 코드 변경 뒤 `preview:build`로 갱신한다. 기본 테마를 수제 CSS로 대체하지 않으며 자산은 Git 제외 `simulations/obsidian-preview/`에만 보관한다. 상호작용이 필요할 때만 연결된 브라우저 도구나 Chrome을 사용하고 Playwright 자동화는 최후 수단으로 둔다. 촬영 불가는 미완료로 명시한다.

검색의 실제품질 합격 기준은 `superpower-goals`의 품질 요구와 이 문서의 게이트·검증 상태 절이, 배포·문구 검사는 `release-contract`가 소유한다. 완료 보고는 실제 명령·종료 상태·한계를 기록하며 같은 변경을 커밋·푸시만을 이유로 반복 검사하지 않는다. 커밋 요청은 커밋만 수행하고 푸시는 별도 요청이 있을 때만 한다. 절차와 권한은 루트 AGENTS에서 확인한다.
