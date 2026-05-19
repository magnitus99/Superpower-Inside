# 개발 환경 설정 가이드

> 이 문서는 로컬 테스트 볼트와 디버깅 환경을 준비하는 데 집중합니다. 코드 구조와 기능 추가 흐름은 [README_FOR_DEV.md](README_FOR_DEV.md)를 보세요.

## 요약

```fish
# 1회성 설정
./scripts/setup-dev.fish

# 터미널 1: esbuild watch
npm run dev

# 터미널 2: Obsidian 디버그 모드
./scripts/launch-obsidian-debug.fish
```

## 필수 조건

| 항목 | 기준 |
| --- | --- |
| OS | macOS |
| Shell | fish |
| Node.js | 22 이상 권장 |
| Package manager | npm |
| Obsidian | Desktop app |

## 자동 설정

권장 방식입니다.

```fish
./scripts/setup-dev.fish
```

스크립트가 하는 일:

| 단계 | 설명 |
| --- | --- |
| 테스트 볼트 생성 | `repo/.test-vault/` 생성 |
| 플러그인 심링크 생성 | `.test-vault/.obsidian/plugins/superpower-inside/` -> 저장소 루트 |
| hot-reload 설치 | `pjeby/hot-reload` 클론 |
| 플러그인 활성화 준비 | 테스트 볼트의 community plugin 설정 갱신 |

> [!IMPORTANT]
> 테스트 볼트에는 저장된 채팅, RAG 벡터, workspace 상태 같은 런타임 산출물이 생깁니다. 일반 기능 변경 커밋에 `.test-vault/` 내용을 포함하지 마세요.

## 수동 설정

자동 설정이 실패할 때만 사용하세요.

### 테스트 볼트 생성

```fish
set -l vault "$PWD/.test-vault"
mkdir -p "$vault/.obsidian/plugins"
printf "# Dev Test Vault\n" > "$vault/Welcome.md"
```

### 플러그인 심링크 생성

복사본이 아니라 심링크여야 `npm run dev`의 빌드 결과가 즉시 반영됩니다.

```fish
set -l repo "$PWD"
set -l plugin_dir "$repo/.test-vault/.obsidian/plugins/superpower-inside"
rm -rf "$plugin_dir"
ln -s "$repo" "$plugin_dir"
```

### hot-reload 설치

```fish
set -l plugins_dir "$PWD/.test-vault/.obsidian/plugins"
git clone https://github.com/pjeby/hot-reload.git "$plugins_dir/hot-reload"
```

Obsidian에서 **hot-reload** 플러그인을 활성화하면 `main.js` 변경 시 Superpower Inside가 자동으로 리로드됩니다.

## 개발 워크플로우

### 터미널 1: esbuild watch

```fish
npm run dev
```

`main.ts` 또는 `src/**/*.ts`를 저장하면 `main.js`가 자동으로 다시 빌드됩니다.

### 터미널 2: Obsidian 디버그 모드

```fish
./scripts/launch-obsidian-debug.fish
```

수동 실행이 필요하면:

```fish
set -l vault "$PWD/.test-vault"
open -a Obsidian --args --remote-debugging-port=9222 "$vault"
```

### DevTools

Obsidian에서 `Cmd+Option+I`를 누릅니다.

확인할 곳:

| 탭 | 용도 |
| --- | --- |
| Console | provider/RAG/MCP 오류 확인 |
| Network | LLM/embedding 요청 확인 |
| Application | IndexedDB 임베딩 캐시 확인 |
| Elements | 채팅 UI DOM 확인 |

### VS Code 디버깅

1. Obsidian을 `--remote-debugging-port=9222`로 실행합니다.
2. VS Code에서 "Attach to Obsidian Renderer" 구성을 선택합니다.
3. TypeScript 파일에 breakpoint를 설정합니다.
4. Obsidian에서 해당 플러그인 동작을 실행합니다.

## 검증 명령어

문서나 코드 변경 후 적용 가능한 검증을 실행합니다.

```fish
npm run lint
npm run typecheck
npm run test
npm run build
```

Obsidian 커뮤니티 제출 또는 릴리스 전에는 CI와 같은 설치 흐름도 확인합니다.

```fish
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

## BRAT로 베타 테스트

[BRAT](https://github.com/TfTHacker/obsidian42-brat)을 사용하면 GitHub Release를 통해 베타 버전을 설치할 수 있습니다.

1. Obsidian 커뮤니티 플러그인에서 **BRAT**을 설치합니다.
2. BRAT 설정에서 **Add Beta plugin**을 선택합니다.
3. Repository에 `magnitus99/Superpower-Inside`를 입력합니다.
4. 설치 후 Superpower Inside를 활성화합니다.

## 문제 해결

| 증상 | 확인할 것 | 해결 |
| --- | --- | --- |
| 플러그인이 보이지 않음 | `main.js`, `manifest.json` 존재 여부 | `npm run build` 실행 후 Obsidian 리로드 |
| watch 결과가 반영되지 않음 | 심링크가 저장소 루트를 가리키는지 | `ls -la .test-vault/.obsidian/plugins/` 확인 |
| hot-reload가 작동하지 않음 | hot-reload 플러그인 활성화 여부 | Obsidian에서 hot-reload 활성화 후 `main.js` 저장 |
| 디버거 연결 실패 | 9222 포트 사용 여부 | `lsof -i :9222`로 점유 프로세스 확인 |
| RAG 상태가 이상함 | 벡터 저장소와 설정 불일치 | 설정 저장 후 필요한 문서만 업데이트하거나 전체 재인덱싱 |

## 산출물 주의

다음 경로는 개발 중 자주 바뀌지만 일반 커밋 대상이 아닙니다.

| 경로 | 성격 |
| --- | --- |
| `.test-vault/.obsidian/workspace.json` | 개인 UI 상태 |
| `.test-vault/.superpower-inside/vectors.json` | RAG 벡터 저장소 |
| `.test-vault/SuperpowerInsideChats/` | 저장된 채팅 세션 |
| `main.js` | 빌드 산출물, 릴리스 때만 확인 |

작업 전후에 범위를 확인하세요.

```fish
git status --short
```
