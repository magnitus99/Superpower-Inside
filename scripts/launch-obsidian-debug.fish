#!/usr/bin/env fish
# Obsidian을 디버그 모드로 실행하는 스크립트 (macOS)
# 사용법: ./scripts/launch-obsidian-debug.fish

set OBSIDIAN_APP "/Applications/Obsidian.app"
set TEST_VAULT_DIR (realpath (dirname (status -f))/..)/.test-vault

if not test -d "$OBSIDIAN_APP"
    echo "ERROR: Obsidian.app를 /Applications에서 찾을 수 없습니다."
    echo "다른 경로에 설치된 경우 OBSIDIAN_APP 환경변수를 설정하세요:"
    echo "  set -x OBSIDIAN_APP /path/to/Obsidian.app"
    exit 1
end

if not test -d "$TEST_VAULT_DIR"
    echo "ERROR: 테스트 볼트가 없습니다. 먼저 setup-dev.fish를 실행하세요."
    exit 1
end

echo "🚀 Obsidian을 디버그 모드로 실행합니다..."
echo "   DevTools: Cmd+Option+I"
echo "   VS Code 디버거: launch.json의 'Attach to Obsidian Renderer' 사용"
echo "   테스트 볼트: $TEST_VAULT_DIR"
echo ""

# --remote-debugging-port=9222 로 실행하면 VS Code에서 renderer 프로세스에 attach 가능
open -a "$OBSIDIAN_APP" --args --remote-debugging-port=9222 "$TEST_VAULT_DIR"
