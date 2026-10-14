#!/usr/bin/env fish
# 날짜 기반 버전을 적용하고 로컬 릴리스 자산을 준비합니다. 게시와 푸시는 별도 단계입니다.

if test (count $argv) -gt 0
    echo "사용법: ./scripts/bump-version.fish"
    echo "Asia/Seoul 기준 YYYY.MM.DD[.증분] 버전을 선택합니다."
    exit 1
end

set CURRENT_BRANCH (git branch --show-current)
if test "$CURRENT_BRANCH" != main
    echo "ERROR: 릴리스 준비는 main 브랜치에서만 할 수 있습니다. 현재 브랜치: $CURRENT_BRANCH"
    exit 1
end

if test (count (git status --porcelain)) -gt 0
    echo "ERROR: 릴리스 준비 전에 작업 변경을 검토하고 커밋하세요."
    exit 1
end

set TODAY (env TZ=Asia/Seoul date +%Y.%m.%d)
set NEW_VERSION "$TODAY"
set -l SAME_DAY_TAGS (git tag --list "$TODAY.*")
set -l MAX_INCREMENT 0
for TAG in $SAME_DAY_TAGS
    set -l PARTS (string split '.' "$TAG")
    if test (count $PARTS) -eq 4; and string match -rq '^[0-9]+$' -- "$PARTS[4]"
        set -l INCREMENT (math $PARTS[4])
        if test $INCREMENT -gt $MAX_INCREMENT
            set MAX_INCREMENT $INCREMENT
        end
    end
end
set -l BASE_TAG (git tag --list "$TODAY")
if test "$BASE_TAG" = "$TODAY"
    set MAX_INCREMENT (math $MAX_INCREMENT + 1)
end
if test $MAX_INCREMENT -gt 0
    set NEW_VERSION "$TODAY.$MAX_INCREMENT"
end

echo "새 버전: $NEW_VERSION"

set -l MIN_APP_VERSION (jq -r '.minAppVersion' manifest.json)
jq --arg v "$NEW_VERSION" '.version = $v' manifest.json > manifest.json.tmp
and mv manifest.json.tmp manifest.json
or exit $status
jq --arg v "$NEW_VERSION" '.version = $v' package.json > package.json.tmp
and mv package.json.tmp package.json
or exit $status
jq --arg v "$NEW_VERSION" --arg min "$MIN_APP_VERSION" '. + {($v): $min}' versions.json > versions.json.tmp
and mv versions.json.tmp versions.json
or exit $status
npm install --package-lock-only --ignore-scripts
or exit $status
npm run release:check
or exit $status

git add manifest.json package.json package-lock.json versions.json main.js styles.css tern_engine_bg.wasm THIRD_PARTY_NOTICES.md generated src/rag/rag-wasm-bytes.ts embeddinggemma-worker.js pdf-worker.js pdf-ocr-worker.js embeddinggemma-runtime.wasm embeddinggemma-runtime.mjs
and git commit -m "chore(release): $NEW_VERSION"
or exit $status

echo "릴리스 커밋이 준비되었습니다. GitHub Release 초안은 검증 완료 후 생성하며 게시 버튼은 누르지 않습니다."
