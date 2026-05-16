# 개발 환경 설정 가이드

## 요약

```bash
# 1회성 설정
./scripts/setup-dev.fish

# 개발 시작
npm run dev                    # 터미널 1: esbuild watch
./scripts/launch-obsidian-debug.fish   # 터미널 2: Obsidian 디버그 모드
```

---

## 1. 자동 설정 (권장)

```bash
./scripts/setup-dev.fish
```

이 스크립트가 수행하는 작업:

1. **테스트 볼트 생성** — `repo/.test-vault/` 폴더 생성
2. **심링크 생성** — `.test-vault/.obsidian/plugins/superpower-inside/` → `repo/`
3. **hot-reload 설치** — `pjeby/hot-reload` 클론
4. **.gitignore 업데이트** — `.test-vault/` 추가

---

## 2. 수동 설정 (자동 설정 실패 시)

### 2.1 테스트 볼트 생성

```bash
mkdir -p ~/Obsidian-Dev-Test-Vault
echo "# Dev Test Vault" > ~/Obsidian-Dev-Test-Vault/Welcome.md
```

### 2.2 심링크 생성 (핵심!)

**복사하지 말고 심링크를 사용하세요.** 복사하면 `npm run dev`의 watch 결과가 반영되지 않습니다.

```bash
# macOS/Linux
ln -s /path/to/repo /path/to/test-vault/.obsidian/plugins/superpower-inside

# Windows (PowerShell, 관리자 권한)
New-Item -ItemType SymbolicLink `
  -Path "C:\Users\You\TestVault\.obsidian\plugins\superpower-inside" `
  -Target "C:\Users\You\Superpower-Inside"
```

### 2.3 hot-reload 설치

```bash
cd /path/to/test-vault/.obsidian/plugins
git clone https://github.com/pjeby/hot-reload.git
```

Obsidian에서 **hot-reload** 플러그인을 활성화하면, `main.js`가 변경될 때 자동으로 플러그인을 리로드합니다.

---

## 3. 개발 워크플로우

### 터미널 1: esbuild watch

```bash
npm run dev
```

`main.ts` 또는 `src/**/*.ts`를 저장하면 `main.js`가 자동 재빌드됩니다.

### 터미널 2: Obsidian 디버그 모드

```bash
./scripts/launch-obsidian-debug.fish
```

또는 수동으로:

```bash
open -a Obsidian --args --remote-debugging-port=9222 /path/to/test-vault
```

### VS Code 디버깅

1. VS Code에서 `F5` 또는 "Run and Debug" 패널 → "Attach to Obsidian Renderer" 선택
2. 브레이크포인트 설정
3. Obsidian에서 플러그인 동작 실행

### DevTools (빠른 확인)

Obsidian 내에서 `Cmd+Option+I` (macOS) 또는 `Ctrl+Shift+I` (Windows/Linux)

---

## 4. BRAT로 베타 테스트

[BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인을 사용하면 GitHub release를 통해 베타 버전을 설치할 수 있습니다.

### BRAT 설치

1. Obsidian 커뮤니티 플러그인 → "BRAT" 검색 → 설치
2. BRAT 설정 열기

### 베타 플러그인 추가

1. "Add Beta plugin with frozen version"
2. Repository: `magnitus99/Superpower-Inside`
3. BRAT이 최신 release를 다운로드하여 설치

### 업데이트

BRAT 설정 → "Check for updates" → 새 release가 있으면 자동 업데이트

---

## 5. 문제 해결

### "플러그인이 로드되지 않음"

- `main.js`가 존재하는지 확인 (`npm run build` 또는 `npm run dev` 실행)
- 심링크가 깨지지 않았는지 확인 (`ls -la .test-vault/.obsidian/plugins/`)
- Obsidian 콘솔 (`Cmd+Option+I`)에서 에러 확인

### "hot-reload가 작동하지 않음"

- hot-reload 플러그인이 **활성화**되어 있는지 확인
- `main.js`의 mtime이 실제로 변경되는지 확인 (`stat main.js`)
- 수동 리로드: Command Palette → "Reload app without saving"

### "VS Code 디버거 attach 실패"

- Obsidian이 `--remote-debugging-port=9222`로 실행 중인지 확인
- 포트 9222가 다른 프로세스에서 사용 중인지 확인 (`lsof -i :9222`)
- "Attach to Obsidian Renderer" 설정에서 `port: 9222` 확인

### "심링크 권한 거부 (Windows)"

PowerShell을 **관리자 권한**으로 실행하거나, Windows 개발자 모드를 활성화하세요.

---

## 6. 프로덕션 빌드

```bash
npm run build      # production 빌드 (minify, no sourcemap)
npm run lint       # 린트 검사
npm run typecheck  # 타입 검사
```

빌드 산출물: `main.js`, `manifest.json`, `styles.css`
