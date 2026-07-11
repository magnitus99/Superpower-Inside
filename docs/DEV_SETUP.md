# 개발 환경 설정 가이드

> 이 문서는 Superpower Inside 테스트 볼트와 Obsidian 디버그 실행을 준비하는 현재 권장 절차를 다룹니다. 코드 구조와 변경 흐름은 [README_FOR_DEV.md](README_FOR_DEV.md)를 보세요.

## 요약

Windows:

```powershell
.\scripts\setup-dev.ps1
npm run dev
.\scripts\launch-obsidian-debug.ps1
```

macOS:

```fish
./scripts/setup-dev.fish
npm run dev
./scripts/launch-obsidian-debug.fish
```

## 필수 조건

| 항목 | 기준 |
| --- | --- |
| OS | Windows 11 또는 macOS |
| Shell | PowerShell on Windows, fish on macOS |
| Node.js | 22 이상 권장 |
| Package manager | npm |
| Obsidian | Desktop app |

Rust/WASM 보안과 빌드 보조 스크립트는 fish로 작성되어 있습니다. Windows에서는 `scripts/run-fish.mjs`가 WSL fish를 호출하므로 `npm run wasm:build`, `npm run rust:security`, `npm run security:full`, `npm run build`를 npm script로 실행하면 됩니다.

## 자동 설정

현재 플랫폼에 맞는 스크립트를 사용합니다.

```powershell
.\scripts\setup-dev.ps1
```

```fish
./scripts/setup-dev.fish
```

스크립트가 하는 일:

| 단계 | Windows | macOS |
| --- | --- | --- |
| 테스트 볼트 생성 | `repo\.test-vault\` | `repo/.test-vault/` |
| 플러그인 링크 | junction to repo root | symlink to repo root |
| hot-reload 설치 | `pjeby/hot-reload` clone | `pjeby/hot-reload` clone |
| 플러그인 활성화 준비 | community plugin 설정 갱신 | community plugin 설정 갱신 |
| Obsidian vault 등록 | Windows Obsidian 설정에 등록 | macOS Obsidian config path 사용 |

> [!IMPORTANT]
> 테스트 볼트에는 저장된 채팅, RAG 벡터, GraphRAG 데이터, workspace 상태 같은 런타임 산출물이 생깁니다. 일반 기능 변경 커밋에 `.test-vault/` 내용을 포함하지 마세요.

## 개발 워크플로우

### 터미널 1: 빌드 감시

```powershell
npm run dev
```

`npm run dev`는 먼저 WASM을 빌드한 뒤 esbuild watch를 시작합니다. `main.ts` 또는 `src/**/*.ts`를 저장하면 `main.js`가 다시 빌드되고, hot-reload가 활성화되어 있으면 Obsidian 쪽 플러그인도 다시 로드됩니다.

### 터미널 2: Obsidian 디버그 실행

Windows:

```powershell
.\scripts\launch-obsidian-debug.ps1
```

macOS:

```fish
./scripts/launch-obsidian-debug.fish
```

Windows 스크립트는 `.test-vault\.obsidian-dev-profile`을 별도 프로필로 쓰고, 사용 가능한 remote debugging port를 찾아 Obsidian을 실행한 뒤 `superpower-inside`와 `hot-reload`를 활성화합니다.

macOS 스크립트는 `/Applications/Obsidian.app`을 기본으로 열고 `--remote-debugging-port=9222`로 테스트 볼트를 실행합니다. 다른 위치에 설치했다면 `OBSIDIAN_APP` 환경 변수를 지정합니다.

```fish
set -x OBSIDIAN_APP /path/to/Obsidian.app
./scripts/launch-obsidian-debug.fish
```

Windows에서 Obsidian 설치 경로를 자동으로 찾지 못하면 환경 변수나 인자로 지정합니다.

```powershell
$env:OBSIDIAN_EXE = "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe"
.\scripts\launch-obsidian-debug.ps1
```

```powershell
.\scripts\launch-obsidian-debug.ps1 -ObsidianPath "C:\Path\To\Obsidian.exe"
```

## 확인할 런타임 상태

Obsidian 조작 자동화가 불안정하면 DevTools나 remote debugging runtime에서 아래 상태를 확인합니다.

```javascript
app.vault.getName();
app.vault.adapter.basePath;
Boolean(app.plugins.plugins['superpower-inside']);
Boolean(app.plugins.plugins['hot-reload']);
Object.keys(app.commands.commands).filter((id) => id.startsWith('superpower-inside:'));
```

## 검증 명령어

문서만 바꾼 경우에는 링크와 stale 문구 검색으로 충분합니다. 코드, UI, 설정, Rust/WASM, 빌드 산출물이 바뀐 경우에는 아래 순서를 기본으로 합니다.

```powershell
npm run security:full
npm run build
npm run review -- --tag <manifest-version> --built
```

UI/DOM/CSS/설정 화면/채팅 화면을 바꾸면 가능하면 실제 화면도 확인합니다. 다만 릴리즈 절차에는 별도 비주얼 체크나 스크린샷 확인 단계를 넣지 않습니다.

### 작업 중심 UI 화면 QA

UI를 크게 바꿨다면 `.test-vault`의 실제 Obsidian 화면에서 아래 순서로 확인합니다. 네이티브 앱을 마우스 자동화하지 말고 Obsidian CLI의 plugin reload, DOM, screenshot, console 명령을 사용합니다.

```fish
obsidian vault=".test-vault" plugin:reload id=superpower-inside
obsidian vault=".test-vault" dev:errors
obsidian vault=".test-vault" dev:console level=error
obsidian vault=".test-vault" dev:screenshot path=/tmp/superpower-inside-ui.png
```

최소 검수 상태:

| 상태 | 확인 항목 |
| --- | --- |
| 첫 화면 | 현재 상태와 가장 중요한 다음 행동이 3초 안에 읽히는지 |
| 기본 설정 | section 안의 설정이 평평한 row로 정렬되고 카드가 중첩되지 않는지 |
| General 상태 | Provider·검색·MCP·채팅 상태가 평평한 행으로 읽히고 primary action이 하나인지 |
| General 진단 | 접힌 상태에서 사용 여부가 보이고, 펼쳤을 때 경로·기록·정리 작업이 잘리지 않는지 |
| General 복구 | 저장 세부값과 전체 초기화가 기본 흐름에서 접혀 있고 위험 설명 뒤에만 버튼이 보이는지 |
| Providers 상태 | 전체·활성·준비 상태와 첫 설정 필요 행동, 추가 행동의 위계가 명확한지 |
| Providers 연결 | 한 번에 하나의 provider만 펼쳐지고 연결 설정과 상태가 평평하게 읽히는지 |
| Providers 모델 | 일반·임베딩 모델 추가, 가져오기, 검증, 삭제가 긴 ID에서도 잘리지 않는지 |
| Providers 위험 | 제거가 마지막 danger disclosure와 확인 modal 뒤에만 노출되는지 |
| Chat 현재 동작 | 활성 프롬프트·자동 저장·도구 정책이 상태와 근거 문장으로 요약되는지 |
| Chat 세부 조정 | 프리셋·초기화, 저장 지연, 도구 재시도가 disclosure 안에서만 노출되는지 |
| Chat 도구 정책 | 항상 자동 실행에서 warning이 보이고 다른 정책에서는 사라지는지 |
| MCP 현재 연결 | 전체·서버별 상태와 오류, 재연결 행동이 한 영역에서 읽히는지 |
| MCP 서버 설정 | JSON 편집기와 검증·저장 상태가 잘리지 않고 가까이 표시되는지 |
| MCP 실행 환경 | PATH·WSL·자동 탐지·저장이 disclosure 안에서만 노출되는지 |
| Advanced | 플러그인 인식 상태·toggle·Context7 경고·기능 한계가 한 section에서 읽히는지 |
| 접힘/펼침 | 아이콘, 제목, 설명, `aria-expanded`가 상태와 일치하는지 |
| 진행 중·disabled | 상태 변화가 텍스트로 전달되고 비활성 이유가 반복되지 않는지 |
| 빈 상태·오류 | 빈 카드 대신 이유와 가능한 다음 행동이 보이는지 |
| 좁은 폭 | 설명 아래로 control이 이동하고 긴 경로·모델명·오류가 잘리지 않는지 |
| 테마·접근성 | dark/light 대비, focus-visible, 키보드 순서, reduced-motion이 유지되는지 |

스크린샷은 커밋 전에 직접 열어 정보 위계, 여백, 밀도, 정렬, 대비를 판단합니다. 이 확인은 UI 작업 완료 조건이지만 릴리즈 명령 자체의 별도 gate로 추가하지 않습니다.

## 문제 해결

| 증상 | 확인할 것 | 해결 |
| --- | --- | --- |
| 플러그인이 보이지 않음 | `main.js`, `manifest.json`, plugin link 존재 여부 | OS별 setup script 후 `npm run build` 실행 |
| watch 결과가 반영되지 않음 | plugin link가 저장소 루트를 가리키는지 | Windows는 junction, macOS는 symlink 확인 |
| Obsidian 실행 실패 | Obsidian 설치 위치 | Windows는 `OBSIDIAN_EXE`, macOS는 `OBSIDIAN_APP` 지정 |
| remote debugging 실패 | 9222 근처 포트 점유 | 기존 Obsidian 프로세스 종료 또는 Windows 스크립트의 선택 port 확인 |
| Graph/RAG 상태가 이상함 | 모델/provider 변경, stale 상태, 실패 파일 | 설정 화면의 상태와 next action을 보고 필요한 최소 작업만 실행 |

## 산출물 주의

다음 경로는 개발 중 자주 바뀌지만 일반 커밋 대상이 아닙니다.

| 경로 | 성격 |
| --- | --- |
| `.test-vault/.obsidian/workspace.json` | 개인 UI 상태 |
| `.test-vault/.superpower-inside/` | RAG/GraphRAG 런타임 저장소 |
| `.test-vault/SuperpowerInsideChats/` | 저장된 채팅 세션 |
| `main.js` | 빌드 산출물, 릴리스 때만 확인 |

작업 전후에 범위를 확인하세요.

```powershell
git status --short
```
