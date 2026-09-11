# AGENTS.md — Superpower Inside

Obsidian 데스크톱 플러그인. TypeScript strict·Obsidian DOM·esbuild CJS를 사용하며 결정적 계산은 Rust/WASM 코어가 담당합니다. 무료·오픈소스를 유지합니다.

## 작업 계약

- 답변·설명·주석은 한국어, 코드 식별자는 영어입니다. macOS 명령은 fish를 명시하고 Windows는 PowerShell을 사용합니다. Node/npm 프로젝트이며 별도 요청 없이 Python을 도입하지 않습니다.
- 먼저 `git status --short --branch`를 확인합니다. 사용자 변경·볼트·설정·키·저장 세션을 보존합니다. 커밋·푸시·릴리스는 사용자가 요청한 범위에서만 실행합니다.
- 모델·추론 강도는 사용자가 선택합니다. 전역 도구·설정·승인 정책을 임의로 바꾸지 않습니다. 스킬은 필요한 작업에만 사용하며 범용 교재나 작업 기록을 저장소에 쌓지 않습니다.
- `rg`로 관련 구현·호출부·테스트를 함께 읽고 테스트 계약부터 고정합니다. 라이브러리 API는 Context7, 없으면 공식 문서나 설치된 타입·소스로 확인합니다.
- 진입점은 `main.ts`, 설정은 `src/settings.ts`, 계산은 `crates/rag-wasm/`, WASM 연결은 `src/rag/rust-core.ts`입니다. 채팅 변경 전 [src/chat/AGENTS.md](src/chat/AGENTS.md)를 읽습니다.
- 설치·디버깅은 [개발 가이드](docs/README_FOR_DEV.md), 버전·태그·배포는 [릴리스 계약](docs/agent-release.md)을 필요한 때 읽습니다. 문서와 코드가 다르면 현재 코드를 확인해 문서를 고칩니다.

## 제품·화면

- 사용자가 신경 쓰지 않아도 알아서 작동하는 편안함을 우선합니다. 새 설정 전에 자동 감지·안전한 기본값·기존 설정 재사용을 검토하고 운영 상태를 계속 관리하게 만들지 않습니다.
- 화면 순서는 `현재 상태 → 가장 작은 다음 행동 → 핵심 설정 → 고급 진단·복구`입니다. 행동이 필요 없으면 조용한 로그로 충분하며, 필요하면 이유 한 문장과 primary action 하나를 제공합니다.
- 최상위 section만 카드로 만들고 내부는 평평한 row·구분선을 사용합니다. 기존 설정 helper와 Obsidian theme variable에 연결된 의미 토큰을 재사용합니다.
- 상태는 label·state·detail로 표현하고 색상에만 의존하지 않습니다. disabled 이유는 영역당 한 번 설명합니다. recovery/destructive action은 마지막 disclosure와 확인 단계에 둡니다.
- disclosure는 button·`aria-expanded`·`aria-controls`·Obsidian icon을 사용합니다. 좁은 폭·긴 텍스트 줄바꿈·키보드 focus·dark/light 대비·reduced-motion을 보장합니다.
- 내부 용어는 사용자가 판단할 때만 노출합니다. 설계가 위 기준을 충족하지 않으면 구현 전에 범위·자동화·화면 구조를 고칩니다.

## TS/Rust 경계

- TS는 Obsidian API·DOM·생명주기·vault I/O·provider 네트워크·MCP stdio·IndexedDB/Dexie·WASM 입출력 매핑만 담당합니다. 새 파싱·정규화·검증·선택·랭킹·diff·검색·그래프 계산은 Rust/WASM에 둡니다.
- Rust는 결정적 입출력만 다루며 DOM·키·프로세스·파일 I/O를 소유하지 않습니다. UI는 최신 snapshot/revision 결과만 반영합니다.
- WASM 초기화·wire-format 실패를 TS 계산으로 대체하지 않습니다. 기존 계약에 맞는 오류·빈 결과·비활성 상태만 반환합니다.
- generated glue·base64는 수동 수정하지 않습니다. `npm run wasm:build`로 생성하며 `build`·`dev`는 WASM 빌드를 먼저 실행해야 합니다.
- Markdown 청킹의 헤딩·코드블록 경계, 위키링크·임베드, 저장 형식의 legacy load·round-trip을 보존합니다. 단순 줄바꿈 청킹으로 대체하지 않습니다.

## 구현 규칙

- 사용자 표시 문자열·기본 프롬프트·도구 설명은 `src/i18n.ts`의 한국어·영어와 `t()`를 사용합니다. 다른 런타임 TS에 한국어 리터럴을 추가하지 않습니다.
- 파일은 `app.vault`·`vault.adapter`·`cachedRead`·`modify`·`create`, 네트워크는 `requestUrl`을 사용합니다. 런타임 `fs`·browser `fetch`·웹 쿠키 크롤링을 늘리지 않습니다. buffered 응답과 best-effort abort capability를 정확히 표시합니다.
- DOM은 Obsidian 생성 API와 `ownerDocument`를 사용합니다. 전역 문서가 필요하면 `activeDocument`, cross-window narrowing은 `node.instanceOf` 또는 `isDomInstance`를 사용합니다.
- `innerHTML`/`outerHTML` 대입, `.style.*`, inline style, `createEl('h1'..'h6')`를 금지합니다. 표시·숨김은 class, 동적 값은 `setCssProps`, 아이콘은 `setIcon`, 설정 heading은 `Setting.setHeading()`을 사용합니다.
- Markdown은 `MarkdownRenderer.render(app, markdown, el, sourcePath, component)`, 확인·입력은 `confirmWithModal`·`promptWithModal`을 사용합니다. 줄바꿈은 text node와 `br`로 만듭니다.
- 설정 내부 refresh는 private helper를 사용하고 `this.display()`를 직접 재호출하지 않습니다. 범위 입력은 슬라이더 대신 min/max/step이 있는 숫자 입력을 사용합니다.
- provider 변경은 키·label·기본값·설정·`createProvider`·validation·메시지/스트림/tool call 테스트를 함께 확인합니다. `saveSettings()`의 provider/RAG 재초기화와 MCP 재연결 부작용을 확인합니다.
- 런타임 로그는 `src/utils/logger.ts`와 점 표기 source를 사용합니다. trace=반복 상세, debug=전환, info=시작, notice=성공, warn=복구 가능, error=실패, fatal=핵심 중단입니다. 429·재시도·backoff·취소·fallback·skip 이유를 기록하되 키·토큰·쿠키·credential은 기록하지 않습니다. 새 `console.*`를 추가하지 않습니다.
- `data.json`에는 평문 키가 있습니다. 출력·공유하지 않습니다. 런타임 `.env`/`process.env` 의존은 기존 MCP PATH 예외 외에 추가하지 않습니다. 의존성 변경 시 `package-lock.json`도 갱신합니다.
- named import/export와 `import type`을 우선합니다. 네이티브 볼트 도구는 읽기 전용이며 MCP stdio의 신뢰·승인·취소 경계를 유지합니다. `isDesktopOnly: true`를 전제로 합니다.

## 검증·완료

- 기능·버그 수정·리팩터링은 회귀 테스트를 먼저 추가하거나 확장합니다. 실패는 재현·분석·수정하며 `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`, clippy allow, `prettier-ignore`로 우회하지 않습니다.
- 코드 변경 후 아래 순서로 실행하고 실패하면 다음 단계로 넘어가지 않습니다.

```fish
npm run security:full
and npm run build
and npm run review -- --tag (node -p "require('./manifest.json').version") --built
```

- `security:full`은 lint → typecheck → Vitest·i18n·채팅 UX → RAG 성능 → Rust fmt·clippy·tests·WASM·deny/audit/vet/geiger·npm audit·generated 정합성을 검사합니다. 임계값이나 제외 항목을 완화하지 않습니다.
- UI/DOM/CSS/카피 배치·상태·모션·접근성 변경은 구조 테스트와 community review에 더해 실제 Obsidian 또는 충실한 시뮬레이션 스크린샷을 직접 찍고 봅니다. 정상·접힘/펼침·빈 상태·오류·disabled·진행 중·좁은 폭과 테마·focus·대비를 확인합니다.
- Obsidian 네이티브 앱의 마우스·타이핑 자동화는 금지합니다. CLI·코드·로그를 사용합니다. 브라우저는 Codex 내부 → Chrome → 최후 수단 Playwright 순서입니다. 화면 검수는 커밋 전에 수행하며 촬영 불가 시 미완료 항목을 명시합니다.
- 문서만 바꾸면 `git diff --check`와 링크·명령을 검증합니다. 완료 보고는 실제 실행한 명령·종료 상태·남은 문제를 포함하며 테스트 통과를 실제 LLM 품질 개선의 증거로 대신하지 않습니다.
- README는 현재 기능·사용 흐름을 설명합니다. 사용자 가치가 있는 기능만 자연스럽게 통합하며 커밋 로그·changelog·릴리스별 변경 파일을 만들지 않습니다. GitHub Release 요약은 사용자 관점으로 본문에만 작성합니다.
