# AGENTS.md — Superpower Inside

이 파일은 이 저장소에서 작업하는 ChatGPT/Codex용 최소 실행 계약이다. 주력 모델은 `gpt-5.6-sol`이며, 긴 역할극이나 범용 하네스보다 목표·경계·검증 기준을 명확히 전달한다.

## 1. 우선순위와 실행 방식

1. 현재 사용자의 명시적 요청과 범위를 먼저 따른다.
2. 이 문서의 제품·아키텍처·품질 불변조건을 지킨다.
3. 기존 코드와 문서에서 확인한 사실을 추측보다 우선한다.

- 설명·검토·진단 요청은 관련 자료를 읽고 근거와 결론을 보고한다. 변경 요청이 없으면 파일을 수정하지 않는다.
- 구현·수정·정리 요청은 범위 안의 로컬 변경과 비파괴 검증을 승인 질문 없이 끝까지 수행한다.
- 파괴적 작업, 외부 시스템 쓰기, 비용 발생, 범위의 실질적 확대만 사전 확인한다.
- 커밋, 푸시, 태그, 릴리즈, PR은 사용자가 그 작업을 명시했을 때만 수행한다.
- 사용자의 기존 변경은 보존한다. 관련 없는 파일을 되돌리거나 정리하지 않는다.
- 막히면 안전한 범위의 조사와 대안을 먼저 소진하고, 필요한 결정만 짧게 묻는다.
- 답변은 결론부터 한국어로 쓴다. 실행한 검증과 남은 위험을 사실대로 구분한다.

## 2. 프롬프트와 에이전트 위생

- 저장소에 범용 에이전트 하네스, 서드파티 skill 묶음, prompt pack, 세션 기록, 자동 생성 계획서·설계서를 추가하지 않는다.
- 저장소 지침은 루트 `AGENTS.md` 하나를 기본으로 한다. 하위 `AGENTS.md`는 실제로 다른 규칙이 필요한 디렉터리에만 추가한다.
- 별도 에이전트나 병렬 작업은 사용자가 요청했거나 작업이 독립적으로 분할되고 명백한 이점이 있을 때만 사용한다.
- 작업용 메모, 스크린샷, 로그, 브라우저 산출물은 추적 파일로 만들지 않는다. 필요하면 기존 ignore 대상 또는 저장소 밖의 임시 위치를 사용한다.
- 프롬프트에는 목표, 관련 맥락, 하드 제약, 허용된 행동, 성공 기준, 필요한 출력 형식만 넣는다. 같은 지시를 반복하지 않는다.
- “더 깊게 생각하라”, 역할극, 장황한 예시로 추론을 유도하지 않는다. 필요한 품질은 검증 기준과 증거 요구로 표현한다.
- 도구 설명과 모델용 기본 프롬프트를 바꿀 때는 현재 동작하는 계약을 기준으로 한 묶음씩 줄이거나 바꾸고 대표 테스트로 회귀를 확인한다.

## 3. 제품 원칙

Superpower Inside는 LLM, RAG, GraphRAG, MCP, 인터넷 검색, 사이드바 채팅, 세션 저장, 출처 첨부를 통합한 데스크톱 전용 Obsidian 플러그인이다.

- 최우선 감성은 2000–2010년대 애플처럼 명료하고, 사용자가 신경 쓰지 않아도 조용히 알아서 작동하는 고급스러움이다.
- 내부 복잡도와 유지보수 상태를 사용자가 관리하게 만들지 않는다. 자동 감지, 안전한 기본값, 기존 설정 재사용, 점진적 공개를 먼저 택한다.
- RAG, GraphRAG, MCP, provider 같은 내부 용어는 사용자가 판단해야 할 때만 노출한다. 일반 흐름에서는 작업 언어로 설명한다.
- 사용자가 해야 할 행동이 없으면 상태 UI 대신 조용한 로그로 충분하다. 행동이 필요하면 이유 한 문장과 primary action 하나를 제공한다.
- 복구 기능은 제공하되 일상 workflow의 중심으로 만들지 않는다.
- 플러그인은 완전 무료·오픈소스로 유지한다. 수익화 기능을 추가하지 않는다.

## 4. 아키텍처 경계

TypeScript/JavaScript는 Obsidian과 브라우저 경계의 프론트엔드·wrapper다. 결정적 기능 로직은 Rust/WASM 코어가 맡는다.

### TypeScript/JavaScript가 소유하는 것

- Obsidian API, DOM 렌더링, plugin lifecycle, settings UI
- vault adapter, IndexedDB/Dexie, provider fetch/stream, MCP stdio 같은 host I/O
- Rust/WASM bridge의 입력 매핑, 출력 검증, 오류 전달

### Rust/WASM이 소유하는 것

- 파싱, 정규화, 검증, 랭킹, scoring, 선택, diff/plan, schema/domain 판정
- RAG 해시·토큰화·청킹·BM25·vector top-k
- GraphRAG ranking, community, entity 계산과 대용량 metadata 처리

- 새 순수 계산이나 정책을 TS에 복제하지 않는다.
- Rust 코어는 deterministic input/output만 다루며 DOM, Obsidian API, API key, process, 파일 I/O를 소유하지 않는다.
- WASM 초기화나 wire-format 검증이 실패해도 TS가 별도 계산 구현으로 우회하지 않는다. 기존 계약에 맞춰 오류, 빈 결과, 비활성 상태 중 하나로 처리한다.

## 5. 품질 기준

- 새 기능, 버그 수정, 리팩터링은 먼저 실패하는 테스트를 추가하거나 기존 테스트 계약을 확장한다.
- `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`, clippy allow, 무근거 fallback, generated 파일 수동 수정으로 검사를 우회하지 않는다.
- 검증 실패는 재현하고 원인을 수정한다. 실행하지 않은 검사를 통과했다고 말하지 않는다.
- 검증은 변경 범위에 비례시킨다. 코드 변경의 기본 완료 순서는 다음과 같다.

```powershell
npm run security:full
npm run build
npm run review -- --tag <manifest-version> --built
```

- 한 단계가 실패하면 원인을 해결하기 전 다음 단계로 넘어가지 않는다.
- Rust/WASM 변경은 `npm run security:full` 전체를 통과해야 한다. 이 게이트는 format, clippy `-D warnings`, Rust tests, wasm build, deny, audit, vet, geiger, npm audit, generated WASM 최신성을 포함한다.
- 문서·하네스 정리처럼 런타임 코드가 바뀌지 않은 작업은 관련 정적 검사와 diff 검토로 검증하되, 불필요한 전체 빌드는 강제하지 않는다.
- 보안, 개인정보, 데이터 손실 가능성이 있는 변경은 정상 경로뿐 아니라 실패·취소·재시도 경로도 테스트한다.

## 6. UI/UX 계약

- 정보 순서는 `현재 상태 → 사용자가 해야 할 가장 작은 행동 → 핵심 설정 → 고급 진단·복구`다.
- 탭 위에는 최상위 section만 카드로 표현한다. 내부는 평평한 row와 구분선을 사용하고 카드 중첩을 만들지 않는다.
- 한 section의 primary action은 최대 하나다. 파괴적·복구 action은 마지막 disclosure와 확인 gate 안에 둔다.
- 상태는 `label + state + supporting detail`로 표현하고 색상만으로 의미를 전달하지 않는다.
- disclosure는 button, Obsidian icon, `aria-expanded`, `aria-controls`를 사용한다.
- 좁은 sidebar, 긴 경로·모델명·오류, dark/light theme, `focus-visible`, reduced motion을 함께 고려한다.
- 색상은 Obsidian theme variable에 매핑하고 raw color를 디자인 기준으로 삼지 않는다.
- UI/DOM/CSS/레이아웃/카피 배치/상태/모션을 바꾸면 실제 Obsidian 또는 충실한 시뮬레이션의 스크린샷을 직접 확인한다. 스크린샷을 볼 수 없으면 UI 검수가 끝났다고 보고하지 않는다.
- Obsidian 네이티브 앱은 이 환경에서 마우스 자동 조작하지 않는다. 코드·빌드·로그를 확인하고 필요한 수동 화면 단계만 사용자에게 남긴다.

## 7. TypeScript와 Obsidian 규칙

- TypeScript strict, `noUnused*`, `noImplicit*`, `isolatedModules`를 유지한다.
- 코드 식별자는 영어로, 답변과 코드 주석은 한국어로 작성한다.
- 사용자 표시 문자열은 `src/i18n.ts`에 한국어와 영어를 모두 정의하고 `t()`로 호출한다. 변경 후 `npm run check:i18n`을 실행한다.
- Obsidian 파일 접근은 `app.vault`, `vault.adapter`, `cachedRead`, `modify`, `create`를 우선한다. 런타임 직접 `fs` 사용을 늘리지 않는다.
- 대부분 named import/export와 `import type`을 사용한다. 하위 디렉터리 barrel 파일은 만들지 않는다.
- DOM 생성은 Obsidian `createEl`, `createDiv`, `createSpan`과 `container.ownerDocument`를 우선한다.
- 런타임 TS에서 `.style.*`, `innerHTML`/`outerHTML` 대입, `attr: { style: ... }`, `createEl('h1'..'h6')`, 전역 `document.create*`를 새로 쓰지 않는다.
- 표시·숨김은 CSS class, 동적 수치는 `setCssProps`, 아이콘은 `setIcon`을 사용한다.
- cross-window DOM 판정은 `node.instanceOf(...)` 또는 `src/utils/dom.ts`의 `isDomInstance(...)`를 사용한다. 브라우저 DOM 생성자에 직접 `instanceof`하지 않는다.
- 네트워크는 Obsidian `requestUrl`을 사용한다. provider/validation 런타임에 browser `fetch`를 새로 추가하지 않는다.
- 사용자 확인·입력은 `src/utils/modal-prompts.ts`의 `confirmWithModal`과 `promptWithModal`을 사용한다.
- Markdown은 `MarkdownRenderer.render(...)`를 사용한다.
- 설정 탭 내부 갱신은 private render helper를 호출하고 이벤트 핸들러에서 `this.display()`를 다시 호출하지 않는다.
- 설정의 범위값은 slider 대신 number input을 사용한다.

## 8. 로깅과 민감 정보

- 런타임 로그는 `src/utils/logger.ts`의 통합 로거만 사용한다. 새 `console.*` 호출을 추가하지 않는다.
- source는 `rag.indexer`, `graph.indexing`, `chat.context`처럼 기능 경계를 드러내는 점 표기법을 쓴다.
- API key, Authorization header, token, cookie, session, password 원문을 로그나 테스트 fixture에 넣지 않는다.
- 429, retry/backoff, abort/cancel, fallback endpoint, indexing skip 사유는 적절한 레벨로 남긴다.
- `data.json`에는 API key가 평문으로 저장될 수 있으므로 공유·출력·커밋하지 않는다.

## 9. 주요 위치

| 작업 | 위치 |
| --- | --- |
| 플러그인 조립·생명주기 | `main.ts` |
| 설정 스키마·설정 UI | `src/settings.ts` |
| 번역 | `src/i18n.ts` |
| LLM provider·streaming | `src/llm/` |
| 채팅 UI·도구·세션·출처 | `src/chat/` |
| 네이티브 볼트 도구·리서치 | `src/agent/` |
| RAG host wrapper·저장·검색 | `src/rag/` |
| GraphRAG orchestration | `src/graph/` |
| MCP stdio | `src/mcp/` |
| Rust/WASM 결정 로직 | `crates/rag-wasm/` |
| WASM bridge·생성물 | `src/rag/rust-core.ts`, `generated/rag-wasm/` |
| 빌드·검증 | `scripts/`, `package.json` |
| 개발 환경·상세 흐름 | `docs/DEV_SETUP.md`, `docs/README_FOR_DEV.md` |

수정 전에는 관련 symbol과 테스트를 검색해 현재 구조를 확인한다. 이 표보다 코드가 우선이다.

## 10. 자주 필요한 명령

```powershell
npm run lint
npm run typecheck
npm run test
npm run check:i18n
npm run security:full
npm run wasm:build
npm run build
npm run review -- --tag <manifest-version> --built
```

- Windows 절차는 PowerShell을 사용한다. Rust/WASM의 fish 스크립트는 npm script 또는 `scripts/run-fish.mjs`를 통해 실행한다.
- 이 저장소는 Node/npm 기반이다. 별도 지시가 없으면 Python/uv를 개발 진입점으로 사용하지 않는다.

## 11. README와 릴리즈

- README는 업데이트 로그가 아니라 현재 제품의 가치와 사용법을 설명한다. 사용자 가치가 생긴 경우 기존 설명에 자연스럽게 통합한다.
- 단순 버그 수정, 내부 알고리즘 조정, 리팩터링은 README에 억지로 추가하지 않는다.
- changelog, 커밋 로그 기반 release note, `release-notes-<version>.md`를 저장소에 만들지 않는다.
- GitHub Release 본문은 사용자가 릴리즈를 요청했을 때만 작성하며, 사용자 관점의 의미 있는 변화만 담는다.
- 버전 변경 시 `manifest.json`, `package.json`, `package-lock.json`, `versions.json`, README badge의 일치를 확인한다.
- 릴리즈는 main push와 tag가 전제다. 요청 없이 버전, tag, release를 변경하지 않는다.

## 12. 변경 전 확인 사항

- Provider 변경: registry/label/default/settings UI/factory/validation/migration을 함께 확인한다.
- 설정 저장 변경: provider, RAG, MCP 재초기화 부작용을 확인한다.
- RAG/GraphRAG 변경: Rust 계산과 TS host orchestration의 경계를 확인한다.
- 채팅 변경: streaming, cancel, retry, persistence, source UI, tool resume의 상태 전이를 확인한다.
- 파일 형식 변경: 기존 vault 데이터와 legacy session 호환성을 확인한다.
- 데스크톱 전용 전제를 유지한다. 모바일 지원을 암묵적으로 약속하지 않는다.
