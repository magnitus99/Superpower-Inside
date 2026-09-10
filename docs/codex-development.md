# Codex 개발 환경

이 저장소는 GPT-6 Astra를 기본 개발 모델로 사용합니다. 설정은 [.codex/config.toml](../.codex/config.toml), 필수 작업 계약은 [AGENTS.md](../AGENTS.md), 세부 개발 흐름은 [개발자 가이드](README_FOR_DEV.md)를 따릅니다. 이 설정은 개발 에이전트용이며 플러그인 사용자의 LLM 설정과는 별개입니다.

## 모델과 적용 범위

- 모델: `gpt-6-astra`.
- 기본 추론 강도: `high`. Rust 계산과 TS 호스트 경계를 함께 검토하는 작업을 고려한 프로젝트 선택입니다. Astra의 공식 최적값이나 성능 향상을 측정한 결과라는 뜻은 아닙니다.
- 짧은 문서·탐색 작업은 `medium`, 어려운 경합·설계 문제는 `xhigh`로 작업별 조정할 수 있습니다. 항상 최고 강도를 적용할 필요는 없습니다.
- 전역 모델·MCP·플러그인·승인 정책은 변경하지 않습니다. 컨텍스트 창·자동 압축 기준·도구 출력 한도도 모델 기본값을 유지합니다.
- 신뢰된 프로젝트에서 프로젝트 설정을 읽습니다. CLI 인자나 기존 데스크톱 작업의 명시적 모델 선택이 우선할 수 있으므로 현재 진행 중인 작업이 자동 전환됐다고 가정하지 않습니다.

새 CLI 작업은 저장소 루트에서 `codex`로 시작합니다. 해당 호출에서 명시하려면 다음처럼 실행합니다.

```fish
codex -m gpt-6-astra -c 'model_reasoning_effort="high"'
```

데스크톱에서는 이 프로젝트의 새 작업을 연 뒤 모델 선택기에 Astra와 원하는 추론 강도가 표시되는지 확인합니다. 적용되지 않았을 때는 작업의 명시적 선택과 프로젝트 신뢰 상태를 먼저 확인합니다.

## 적게 읽고 정확하게 작업하기

1. `git status --short --branch`로 기존 변경을 확인합니다.
2. 루트 `AGENTS.md`와 작업 영역의 하위 `AGENTS.md`를 읽습니다.
3. `rg --files src crates scripts`로 범위를 찾고 구현·호출부·회귀 테스트를 함께 읽습니다.
4. 필요할 때만 [코드 참고표](agent-code-map.md)의 해당 기능을 읽습니다. 표 자체가 현재 코드의 증거는 아닙니다.
5. 재현과 테스트 계약을 먼저 고정하고 TS 호스트 처리와 Rust 결정적 계산을 나누어 수정합니다.
6. 검증을 순서대로 실행하고 변경 범위와 남은 실패를 보고합니다.

루트 지침에는 모든 작업의 필수 규칙만 둡니다. 기능 심볼 목록, 상세 예시, 릴리스 절차는 연결된 문서에서 필요할 때 읽습니다. 프로젝트 지침 한도를 늘려 대형 문서를 매번 주입하는 방법은 기본 해법으로 삼지 않습니다.

## 도구와 로컬 실행

- macOS는 fish를 명시합니다. 실행 도구의 기본 셸이 다르면 `fish -c '명령'`을 사용합니다.
- 의존성 재설치가 필요한 깨끗한 개발 환경에서는 `npm ci`를 사용합니다. 기존 작업 중에는 이유 없이 의존성이나 잠금 파일을 갱신하지 않습니다.
- Node/npm 버전은 실제 실행 환경과 `.github/workflows/release.yml`을 함께 확인합니다. 릴리스 workflow의 자산 검사가 전체 로컬 보안 검사를 대신하지 않습니다.
- Rust는 `rust-toolchain.toml`의 1.96.0을 기준으로 합니다. PATH의 Homebrew `rustc` 버전과 다를 수 있으므로 기존 npm의 `wasm:build`, `rust:security` 진입점을 사용합니다. 이 스크립트가 지정 도구체인을 선택합니다.
- 보안 도구 준비는 기존 `scripts/install-rust-security-tools.fish`를 확인합니다. 준비 상태를 확인하지 않고 설치를 반복하지 않습니다.
- UI 확인은 Obsidian CLI와 실제 화면 캡처를 우선하고, 네이티브 앱의 마우스·타이핑 자동화를 사용하지 않습니다. 테스트 볼트 준비는 [DEV_SETUP.md](DEV_SETUP.md)를 따릅니다.
- 라이브러리 API는 Context7 → 공식 문서·설치된 소스 순으로 확인합니다. CodeGraph는 인덱스 최신성을 확인했을 때 탐색 보조로 쓰고, 결과가 없거나 오래됐으면 `rg`와 소스로 확인합니다.

## 검증

코드 변경의 완료 검증은 다음 명령입니다. 앞 단계가 실패하면 다음 단계로 넘어가지 않습니다.

```fish
npm run security:full
and npm run build
and npm run review -- --tag (node -p "require('./manifest.json').version") --built
```

`security:full`은 lint → typecheck → Vitest·i18n·채팅 UX 검사 → RAG 성능 검사 → Rust 보안 검사를 포함합니다. 개별 테스트는 개발 중 빠른 피드백에 사용하며 최종 게이트를 대체하지 않습니다. UI 변경에는 별도로 직접 확인한 스크린샷이 필요합니다.

설정·문서만 바꿀 때도 `git diff --check`, 문서 링크·명령 검증, Codex 설정 로딩을 확인합니다. CLI에 해당 진단 명령이 있는 버전에서는 다음을 사용할 수 있습니다.

```fish
codex --version
codex debug models --bundled
codex --strict-config doctor --summary
```

`models --bundled`는 설치된 CLI의 모델 목록을 보여줍니다. 서버에서 실제 모델 요청이 성공했다는 검증은 아닙니다. `doctor`의 전역 MCP·작업 이력·터미널 경고는 저장소 검증 결과와 구분합니다. 진단 전체에 민감한 설정이 있을 수 있으므로 원문을 저장소에 커밋하지 않습니다.

## 확인 근거

2026-09-10에 설치된 Codex CLI 0.154.0의 모델 목록에서 `gpt-6-astra`와 `high` 지원을 확인했습니다. 모델별 공개 검색 도구는 접근 오류가 발생했으므로 Astra의 미확인 성능·가격·컨텍스트 크기에 기대는 설정은 추가하지 않았습니다.

- [공식 Codex 설정 문서](https://developers.openai.com/codex/config-reference/): 프로젝트 설정, 모델과 추론 강도, 지침 크기 설정.
- [공식 AGENTS.md 안내](https://developers.openai.com/codex/guides/agents-md/): 지침 탐색과 크기 한도.
- 모델 ID와 지원 강도는 위 로컬 CLI 목록 및 현재 앱의 제공 모델을 근거로 삼습니다. 이후 버전에서는 다시 확인합니다.

## 환경 확인 결과와 남은 문제

2026-09-10 로컬 확인 결과입니다. 이후 코드·도구 버전이 바뀌면 다시 검증합니다.

- App Server의 `config/read`로 실효 모델 `gpt-6-astra`, 강도 `high`, 두 값의 출처가 이 저장소의 `.codex/config.toml`임을 확인했습니다. 모델 요청이나 별도 작업 생성 없이 설정만 조회했습니다.
- `npm run security:full` → `npm run build` → `npm run review -- --tag 2.1.4 --built`가 모두 exit 0으로 통과했습니다. Vitest 1,294개 통과·1개 skip, Rust 288개 통과·1개 ignored이며 기존 제외 상태를 바꾸지 않았습니다.
- npm audit은 기존 의존성의 취약점 10개(high 6, moderate 4)를 보고했습니다. 현재 게이트는 `--audit-level=critical`이므로 종료 코드는 0이지만 취약점이 없다는 뜻은 아닙니다. 이번 모델·지침 설정 작업에서는 의존성과 보안 임계값을 변경하지 않았습니다.
- 전역 설정의 `profiles.ollama-launch.openai_base_url`은 CLI 0.154.0의 엄격한 App Server 설정 검사에서 unknown field로 거부됐습니다. 일반 설정 조회는 성공했습니다. 다른 프로젝트에도 영향을 주는 전역 Ollama 프로필은 수정하지 않았으며, 엄격한 전체 설정 검사는 미통과 상태입니다.
- `codex doctor`는 비대화형 실행 환경의 `TERM=dumb` 오류, 선택적 MCP 환경변수 문제, 기존 작업 이력 불일치를 보고했습니다. 저장소 코드 문제와 구분하며, 전역 연결·이력 데이터를 자동 삭제하거나 변경하지 않았습니다.
