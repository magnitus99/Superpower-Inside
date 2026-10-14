#!/usr/bin/env fish
set BUMP_TYPE patch
for ARG in $argv
    switch "$ARG"
        case patch minor major
            set BUMP_TYPE "$ARG"
        case -h --help
            echo "사용법: ./scripts/bump-version.fish [patch|minor|major]"
            echo "기본값: patch"
            exit 0
        case '*'
            echo "ERROR: 유효하지 않은 인자 '$ARG'"
            echo "사용법: ./scripts/bump-version.fish [patch|minor|major]"
            exit 1
    end
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

set CURRENT_VERSION (jq -r '.version' manifest.json)
if not string match -rq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -- "$CURRENT_VERSION"
    echo "ERROR: manifest.json 버전이 SemVer x.y.z 형식이 아닙니다: $CURRENT_VERSION"
    exit 1
end
set PARTS (string split '.' "$CURRENT_VERSION")
set MAJOR $PARTS[1]
set MINOR $PARTS[2]
set PATCH $PARTS[3]
switch $BUMP_TYPE
    case major
        set MAJOR (math $MAJOR + 1)
        set MINOR 0
        set PATCH 0
    case minor
        set MINOR (math $MINOR + 1)
        set PATCH 0
    case patch
        set PATCH (math $PATCH + 1)
end
set NEW_VERSION "$MAJOR.$MINOR.$PATCH"

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
