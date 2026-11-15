#!/usr/bin/env fish
# Obsidian 플러그인 개발 환경 자동 설정 스크립트
# 사용법: ./scripts/setup-dev.fish

set PLUGIN_ID "superpower-inside"
set REPO_ROOT (realpath (dirname (status -f))/..)
set -l PLUGIN_OUTPUT (node --input-type=module -e 'const { ARTIFACT_PATHS } = await import(process.argv[1]); console.log(ARTIFACT_PATHS.plugin)' "file://$REPO_ROOT/scripts/artifact-paths.mjs")
or exit $status
set -l PLUGIN_TARGET "$REPO_ROOT/$PLUGIN_OUTPUT"
if not test -f "$PLUGIN_TARGET/main.js"; or not test -f "$PLUGIN_TARGET/manifest.json"
    echo "ERROR: 먼저 npm run build:dev로 플러그인을 빌드하세요: $PLUGIN_TARGET" >&2
    exit 1
end
set OBSIDIAN_CONFIG_DIR "$HOME/Library/Application Support/obsidian"
set TEST_VAULT_DIR "$REPO_ROOT/.test-vault"
set PLUGINS_DIR "$TEST_VAULT_DIR/.obsidian/plugins/$PLUGIN_ID"
set HOT_RELOAD_DIR "$TEST_VAULT_DIR/.obsidian/plugins/hot-reload"

# --- 1. 테스트 볼트 생성 ---
if test -d "$TEST_VAULT_DIR"
    echo "✅ 테스트 볼트가 이미 존재합니다: $TEST_VAULT_DIR"
else
    echo "📁 테스트 볼트 생성 중..."
    mkdir -p "$TEST_VAULT_DIR"
    echo "# Test Vault\n\nThis vault is for developing the Superpower Inside plugin." > "$TEST_VAULT_DIR/Welcome.md"
    echo "✅ 테스트 볼트 생성 완료"
end

# --- 2. 플러그인 심링크 ---
if test -L "$PLUGINS_DIR"
    set -l LINK_TARGET (readlink "$PLUGINS_DIR")
    if not test -e "$PLUGINS_DIR"; or test (realpath "$PLUGINS_DIR") != "$PLUGIN_TARGET"
        echo "ERROR: 기존 플러그인 연결이 다른 경로를 가리킵니다($LINK_TARGET). 연결만 직접 제거한 뒤 setup을 다시 실행하여 재설정하세요: $PLUGINS_DIR → $PLUGIN_TARGET" >&2
        exit 1
    end
    echo "✅ 플러그인 심링크가 이미 존재합니다"
else if test -e "$PLUGINS_DIR"
    echo "ERROR: 플러그인 경로가 이미 존재합니다. 원본을 보존하고 경로를 직접 재설정하세요: $PLUGINS_DIR" >&2
    exit 1
else
    echo "🔗 플러그인 심링크 생성 중..."
    mkdir -p (dirname "$PLUGINS_DIR")
    ln -s "$PLUGIN_TARGET" "$PLUGINS_DIR"
    or exit $status
    echo "✅ 심링크 생성 완료: $PLUGINS_DIR → $PLUGIN_TARGET"
end

# --- 3. Hot-Reload 플러그인 설치 ---
if test -d "$HOT_RELOAD_DIR"
    echo "✅ hot-reload 플러그인이 이미 설치되어 있습니다"
else
    echo "🔥 hot-reload 플러그인 설치 중..."
    mkdir -p (dirname "$HOT_RELOAD_DIR")
    git clone --depth 1 https://github.com/pjeby/hot-reload.git "$HOT_RELOAD_DIR"
    echo "✅ hot-reload 설치 완료"
end

# --- 4. .gitignore 업데이트 ---
if not grep -q "^\.test-vault/" "$REPO_ROOT/.gitignore"
    echo "\n# --- Test vault ---\n.test-vault/" >> "$REPO_ROOT/.gitignore"
    echo "✅ .gitignore에 .test-vault/ 추가 완료"
end

# --- 5. 요약 ---
echo ""
echo "========================================"
echo "🎉 개발 환경 설정 완료!"
echo "========================================"
echo ""
echo "테스트 볼트: $TEST_VAULT_DIR"
echo "심링크:     $PLUGINS_DIR → $PLUGIN_TARGET"
echo ""
echo "다음 단계:"
echo "  1. npm run dev        (esbuild watch 시작)"
echo "  2. ./scripts/launch-obsidian-debug.fish  (Obsidian 디버그 모드 실행)"
echo "  3. Obsidian에서 테스트 볼트 열기"
echo "  4. 설정 → 커뮤니티 플러그인 → hot-reload 활성화"
echo "  5. 설정 → 커뮤니티 플러그인 → Superpower Inside 활성화"
echo ""
echo "이제 파일 저장 시 자동으로 빌드 & 리로드됩니다."
echo "========================================"
