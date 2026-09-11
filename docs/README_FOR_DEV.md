# 개발 가이드

프로젝트 고유 구현·검증 규칙은 [AGENTS.md](../AGENTS.md), 배포 절차는 [릴리스 계약](agent-release.md)을 따릅니다. 사용자 안내는 [README](../README.md)에 있습니다.

## 환경 준비

Node.js 22 이상·npm, Obsidian 데스크톱, [rust-toolchain.toml](../rust-toolchain.toml)의 Rust 도구체인이 필요합니다. macOS는 fish, Windows는 PowerShell과 WSL fish를 사용합니다. Rust 보조 명령은 npm의 `scripts/run-fish.mjs` 경유로 실행합니다.

깨끗한 checkout에서는 `npm ci`로 의존성을 설치합니다. Rust 보안 도구는 `scripts/install-rust-security-tools.fish`를 확인해 준비합니다. 기존 환경의 의존성·전역 설정을 이유 없이 재설치하거나 바꾸지 않습니다.

macOS에서 테스트 볼트를 준비합니다.

```fish
./scripts/setup-dev.fish
npm run dev
```

별도 터미널에서 실행합니다.

```fish
./scripts/launch-obsidian-debug.fish
```

Windows에서는 다음 명령을 사용하며 watch가 실행 중인 동안 별도 터미널에서 launch 명령을 실행합니다.

```powershell
.\scripts\setup-dev.ps1
npm run dev
# 별도 터미널
.\scripts\launch-obsidian-debug.ps1
```

setup은 `.test-vault`와 저장소를 가리키는 플러그인 링크(macOS symlink, Windows junction), hot-reload를 준비합니다. 실제 활성화 상태는 Obsidian에서 확인합니다. 테스트 볼트에는 사용자 세션과 인덱스가 생기므로 일반 정리·커밋 대상이 아닙니다.

macOS 기본 앱 경로는 `/Applications/Obsidian.app`이며 다르면 `set -x OBSIDIAN_APP /path/to/Obsidian.app`을 지정합니다. Windows는 `OBSIDIAN_EXE` 또는 launch 스크립트의 `-ObsidianPath`를 사용합니다. Windows 디버그 실행은 별도 프로필과 사용 가능한 포트를, macOS는 9222 포트를 사용합니다.

## 빌드·검증

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | WASM·worker 생성 후 TS watch. Rust 수정 시 다시 실행 |
| `npm run wasm:build` | Rust glue·embedded bytes·worker 생성 |
| `npm run security:full` | lint·타입·테스트·성능·Rust/npm 보안·generated 정합성 |
| `npm run build` | WASM·worker·Ternlight 자산과 production 번들 |
| `npm run review -- --tag <manifest-version> --built` | Obsidian 배포 자산·community review |

완료 검증은 AGENTS.md의 순서를 따릅니다. 개별 Vitest는 수정 중 빠른 회귀 확인에 사용하며 최종 검증을 대체하지 않습니다. `npm audit`의 현재 임계값은 critical이므로 exit 0이어도 낮은 등급의 취약점은 별도로 보고합니다.

`generated/`, `src/rag/rag-wasm-bytes.ts`, `tern_engine_bg.wasm`은 현재 빌드·검증·배포 계약에 연결됩니다. 수동 삭제·편집하지 않습니다. `main.js`는 재생성되지만 실행 중인 테스트 볼트가 저장소를 직접 참조할 수 있습니다.

## 런타임 확인

설치된 `obsidian help`로 CLI 지원 명령을 확인하고 대상 볼트를 명시합니다. 네이티브 앱을 마우스·타이핑 자동화하지 않습니다.

```fish
obsidian vault=".test-vault" plugin:reload id=superpower-inside
obsidian vault=".test-vault" dev:errors
obsidian vault=".test-vault" dev:console level=error
obsidian vault=".test-vault" dev:screenshot path=/tmp/superpower-inside-ui.png
```

스크린샷을 직접 열어 AGENTS.md의 상태·폭·접근성 계약을 확인합니다. CLI가 없으면 코드·remote debugging으로 같은 테스트 볼트를 확인하며 실제 사용자 설정이나 저장 세션을 덮어쓰지 않습니다.

| 증상 | 확인 |
| --- | --- |
| 플러그인이 보이지 않음 | plugin link, `main.js`·`manifest.json`, 활성화 상태 |
| 변경이 반영되지 않음 | 저장소를 가리키는 링크, watch·hot-reload, Rust 재빌드 |
| 디버그 실행 실패 | 앱 설치 경로와 포트 점유 |
| RAG/Graph 상태 이상 | 모델 변경·stale·실패 파일과 진단 로그. 무조건 reset하지 않음 |

## 기능 변경 시 확인할 계약

- **채팅:** [채팅 지침](../src/chat/AGENTS.md)의 취소·세션 전환·저장 round-trip과 출처 검증을 확인합니다.
- **리서치:** `src/agent/research-agent.ts`와 `crates/rag-wasm/src/research_contract.rs`의 로컬 선별·전송 예산·coverage를 확인합니다. 실제 읽은 범위만 주장하고 native/호환 도구 호출 모두 검증합니다.
- **Provider:** `src/llm/providers.ts`·`validation.ts`·`src/settings.ts`의 모델 선택·request·stream·tool call 왕복을 함께 확인합니다.
- **RAG/Graph:** `src/rag/`·`src/graph/`의 인덱싱·상태·검색과 Rust 계약을 함께 확인합니다. 헤딩·코드블록·링크 경계 및 missing/stale/partial/schema-error 복구를 보존합니다.
- **MCP:** `src/mcp/`의 stdio·신뢰 서버·멘션·승인·취소를 확인합니다. 도구 인자·결과가 provider로 전달되는 경계를 보존합니다.
- **프롬프트:** 문자열 검사는 조립 계약만 검증합니다. 품질 변경은 동일 모델·합성 자료로 기존안과 비교해 출처 정확성·범위 한계·질문 누락·불필요한 호출을 확인합니다. 실제 노트나 키를 평가 산출물에 저장하지 않습니다.
