---
id: engineering-contract
type: architecture-design
status: draft
title: 구현·데이터 보호와 검증 계약
parent: superpower-architecture
references: [deterministic-core, interface-design, search-quality, release-contract, provider-boundary]
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

## 프롬프트 작성

프롬프트는 목표·관련 근거·필요한 출력·실제 경계를 명확히 하고 과도한 단계 강제나 사고 과정 출력을 요구하지 않는다. 사용자 선택 모델·추론을 문서 최적화에 끼워 바꾸지 않는다. [ChatGPT 공식 프롬프팅 가이드](https://learn.chatgpt.com/docs/prompting)를 기준으로 삼고, GPT-6.1 Sol 대상이면 [모델 문서](https://developers.openai.com/api/docs/models/gpt-6.1-sol)·[프롬프팅 지침](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)도 실제 작업에서 확인한다. 이 링크 편입은 이번 작업에서 외부 문서 최신성을 재검증했다는 뜻이 아니며 모델별 권고가 provider·도구·저장 계약보다 우선하지 않는다.

## 테스트 볼트와 평가 데이터

테스트 볼트는 언제든 내용이 교체될 수 있는 로컬 자료다. 특정 문서·질의·정답을 제품 규칙이나 회귀 fixture로 고정하지 않는다. 원문·문서명·경로·고유 표현·관계·질의·기대 답변·임베딩과 이를 복원할 수 있는 변형을 코드·테스트·snapshot·공유 문서·커밋·기억에 복제하지 않는다. 커밋할 회귀 자료는 볼트와 독립적인 합성 데이터로 만들고 다른 내용·언어에서도 같은 계약을 확인한다.

공개 검색 연구는 전체 코퍼스의 고정 버전·권리·정답 신뢰도·개발/보류 구분을 기록하고 같은 엔진 경로·질의·조건에서 기준선과 변경 후 품질·누락·지연·자원을 비교한다. 평가 코드·질의·정답·기록은 Git 제외 벤치마크 공간에 격리하고 색인하지 않는다. 검색 대상 코퍼스의 색인과 Git 제외는 별도 정책이다. 합성 회귀를 실제 데이터의 성능 증거로 쓰지 않는다.

실제 볼트 검증은 사용자 요청 또는 실제 볼트에서만 재현되는 문제에 필요한 범위로 제한한다. 임시 스크립트·복사본·로그·스크린샷·임베딩·캐시는 생성 전 git check-ignore로 확인한 별도 경로에 둔다. 외부 도구·채팅·공유 보고서에 식별 원문을 출력하지 않는다. 성공·실패와 무관하게 이번 생성물만 정리하고 잔존 여부를 확인한다. 기존 볼트·설정·색인·저장 세션은 보존하며 정리 불가·보존 미확인은 미완료로 보고한다.

볼트 유출 검사는 단위 테스트와 별도 단계로 격리하되 npm test와 quality:local에 항상 포함한다. 볼트가 없으면 생략하고 내용 없이 파일 위치만 출력한다. 추적 파일과 미스테이징 새 파일도 검사하며 src/i18n.ts의 사용자 정본 문구는 위반으로 간주하지 않는다. 검사 통과는 실제 답변 품질의 증거가 아니다.

## 검증 범위와 게이트

기능·버그 수정·리팩터링은 회귀 테스트를 먼저 추가하거나 확장한다. lint 비활성·타입 검사 무시·as any·clippy allow·prettier-ignore로 실패를 우회하지 않는다. 설치된 의존성·생성물로 오프라인 검증하고 Rust는 --frozen을 사용한다. 의존성이 없으면 준비 필요로 실패하며 네트워크·모델 호출로 조용히 대체하지 않는다.

quality:local은 HEAD 대비 스테이징·작업 파일·새 파일을 기준으로 필요한 검사를 고른다. CI는 --base로 실제 비교 커밋을 전달한다. TS는 lint → typecheck → 전체 Vitest·i18n·채팅 UX·오프라인 계약, 스크립트/CSS/CI는 관련 계약, Rust/WASM 경계는 TS 및 Rust fmt·clippy·tests를 확인한다. 문서·설명·버전만 바꾸면 community review·diff 및 링크·명령을 확인하고 변경 없는 Rust·성능·온라인 보안·Patina를 강제하지 않는다. 현재 검사기의 경로 분류가 명세 파일에도 넓은 검사를 선택할 수 있으며 게이트를 완화하지 않는다.

의존성·보안 정책 변경의 CI와 수동·릴리스 CI는 security:full을 사용한다. 일반 PR/main CI는 변경 범위만 검사하고 문서만 바뀌면 도구 설치·코드 검사도 생략한다. 이전 PR/main 실행은 새 커밋에서 취소한다. security:full의 기존 순서·측정 데이터·임계값·제외 정책을 유지하고 릴리스 게시가 전체 검사 성공을 기다리게 한다.

UI/DOM/CSS/카피 배치·상태·모션·접근성 변경은 구조 테스트와 community review 외에 실제 Obsidian 또는 충실한 시뮬레이션 스크린샷을 직접 확인한다. 정상·빈 상태·접기/펼치기·오류·disabled·진행·좁은 폭·테마·focus·대비를 포함한다. 네이티브 앱의 마우스·타이핑 자동화는 금지하며 CLI·코드·로그를 사용한다.

브라우저 preview는 npm run preview:prepare로 설치된 Obsidian CSS·자산·합성 Markdown을 준비하고 npm run preview로 실행한다. 제품 코드 변경 뒤 preview:build로 갱신하고 ?check 또는 제품 계약 검사로 기본 스타일·호스트·저장 계약을 확인한다. 기본 테마를 수제 CSS로 대체하지 않으며 자산은 Git 제외 simulations/obsidian-preview에만 보관한다. 브라우저는 연결된 도구 → Chrome → 최후 Playwright 순서로 사용하고 화면 확인은 커밋 전에 수행한다. 촬영 불가는 미완료로 명시한다.

검색의 실제품질 합격은 `search-quality`, 배포·문구 검사는 `release-contract`가 소유한다. 완료 보고는 실제 명령·종료 상태·한계를 기록하며 같은 변경을 커밋·푸시만을 이유로 반복 검사하지 않는다. 절차와 권한은 루트 AGENTS에서 확인한다.
