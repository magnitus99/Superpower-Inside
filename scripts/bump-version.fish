#!/usr/bin/env fish
# 버전을 올리고 Obsidian 커뮤니티 제출 규칙에 맞는 git 태그를 생성한 뒤 푸시하는 스크립트
# 사용법: ./scripts/bump-version.fish [patch|minor|major] [--no-release]
# 기본값: patch

set BUMP_TYPE patch
set CREATE_RELEASE true

for ARG in $argv
    switch "$ARG"
        case patch minor major
            set BUMP_TYPE "$ARG"
        case --no-release
            set CREATE_RELEASE false
        case -h --help
            echo "사용법: ./scripts/bump-version.fish [patch|minor|major] [--no-release]"
            echo "기본값: patch"
            echo "옵션: --no-release  (릴리스 생성 단계는 생략)"
            exit 0
        case '*'
            echo "ERROR: 유효하지 않은 인자 '$ARG'"
            echo "사용법: ./scripts/bump-version.fish [patch|minor|major] [--no-release]"
            exit 1
    end
end

set CURRENT_BRANCH (git branch --show-current)
set REQUIRED_RELEASE_BRANCH main
if test "$CURRENT_BRANCH" != "$REQUIRED_RELEASE_BRANCH"
    echo "ERROR: 버전 커밋과 릴리스 태그는 $REQUIRED_RELEASE_BRANCH 브랜치에서만 만들 수 있습니다. 현재 브랜치: $CURRENT_BRANCH"
    exit 1
end

# 현재 버전 읽기
set CURRENT_VERSION (jq -r '.version' manifest.json)
echo "현재 버전: $CURRENT_VERSION"

# semantic version 파싱
set PARTS (string split '.' $CURRENT_VERSION)
set MAJOR $PARTS[1]
set MINOR $PARTS[2]
set PATCH $PARTS[3]

# 버전 증가
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

# manifest.json 업데이트
jq --arg v "$NEW_VERSION" '.version = $v' manifest.json > manifest.json.tmp
and mv manifest.json.tmp manifest.json
or begin
    echo "ERROR: manifest.json 업데이트 실패"
    exit 1
end

# package.json 업데이트
jq --arg v "$NEW_VERSION" '.version = $v' package.json > package.json.tmp
and mv package.json.tmp package.json
or begin
    echo "ERROR: package.json 업데이트 실패"
    exit 1
end

# versions.json 업데이트
set MIN_APP_VERSION (jq -r '.minAppVersion' manifest.json)
jq --arg v "$NEW_VERSION" --arg min "$MIN_APP_VERSION" '. + {($v): $min}' versions.json > versions.json.tmp
and mv versions.json.tmp versions.json
or begin
    echo "ERROR: versions.json 업데이트 실패"
    exit 1
end

# lockfile 업데이트
npm install --package-lock-only --ignore-scripts
or begin
    echo "ERROR: package-lock.json 업데이트 실패"
    exit 1
end

# 릴리스 검증
npx -y npm@10 ci
or begin
    echo "ERROR: npm ci 실패"
    exit 1
end

npm run lint
or begin
    echo "ERROR: lint 실패"
    exit 1
end

npm run typecheck
or begin
    echo "ERROR: typecheck 실패"
    exit 1
end

npm run test
or begin
    echo "ERROR: test 실패"
    exit 1
end

npm run rust:security
or begin
    echo "ERROR: Rust/WASM 보안 게이트 실패"
    exit 1
end

npm run review -- --tag "$NEW_VERSION"
or begin
    echo "ERROR: Obsidian review gate 실패"
    exit 1
end

npm run build
or begin
    echo "ERROR: 빌드 실패"
    exit 1
end

npm run review -- --tag "$NEW_VERSION" --built
or begin
    echo "ERROR: Obsidian release asset 검증 실패"
    exit 1
end

# 커밋
git add manifest.json package.json package-lock.json versions.json main.js styles.css scripts/validate-obsidian-review.mjs .github/workflows/release.yml scripts/bump-version.fish scripts/install-rust-security-tools.fish scripts/patch-rag-wasm-dts.mjs scripts/build-rag-wasm.fish generated/rag-wasm/rag_wasm.d.ts README.md esbuild.config.mjs
and git commit -m "chore(release): $NEW_VERSION"
or begin
    echo "ERROR: git commit 실패"
    exit 1
end

# 태그 생성
# Obsidian 커뮤니티 제출은 manifest.json version과 완전히 같은 태그명을 요구한다.
git tag -a "$NEW_VERSION" -m "Release $NEW_VERSION"
or begin
    echo "ERROR: git tag 생성 실패"
    exit 1
end

set RELEASE_NOTE_FILE "release-notes-$NEW_VERSION.md"
set RELEASE_TAGS (git tag --sort=version:refname --list '[0-9]*')
set PREV_TAG ""
for index in (seq 1 (count $RELEASE_TAGS))
    if test "$RELEASE_TAGS[$index]" = "$NEW_VERSION"
        if test $index -gt 1
            set PREV_TAG $RELEASE_TAGS[(math $index - 1)]
        end
        break
    end
end

if test -n "$PREV_TAG"
    ./scripts/release-notes.fish "$NEW_VERSION" "$PREV_TAG" "$RELEASE_NOTE_FILE"
    if test $status -ne 0
        echo "ERROR: release-notes 생성 실패"
        exit 1
    end
else
    echo "INFO: 이전 태그가 없어 release-notes를 자동 생성하지 않습니다."
    set RELEASE_NOTE_FILE ""
end

# 푸시
git push origin "$CURRENT_BRANCH"
and git push origin "$NEW_VERSION"
or begin
    echo "ERROR: git push 실패"
    exit 1
end

if test -n "$RELEASE_NOTE_FILE"
    if test "$CREATE_RELEASE" = true
        if not type gh >/dev/null 2>&1
            echo "WARN: gh CLI가 없습니다. 수동으로 릴리즈를 생성해 주세요."
            echo "gh release create \"$NEW_VERSION\" --title \"Release $NEW_VERSION\" --notes-file \"$RELEASE_NOTE_FILE\" --target \"$CURRENT_BRANCH\""
        else
            gh release create "$NEW_VERSION" --title "Release $NEW_VERSION" --notes-file "$RELEASE_NOTE_FILE" --target "$CURRENT_BRANCH"
            if test $status -ne 0
                echo "WARN: gh release create 실패 (수동으로 다시 실행해 주세요)"
                echo "gh release create \"$NEW_VERSION\" --title \"Release $NEW_VERSION\" --notes-file \"$RELEASE_NOTE_FILE\" --target \"$CURRENT_BRANCH\""
            end
        end
    else
        echo "INFO: --no-release 옵션으로 gh 릴리스 생성은 생략합니다."
    end
end

echo ""
echo "✅ $NEW_VERSION 릴리스 완료!"
echo "GitHub Actions가 자동으로 릴리스를 생성합니다."
echo "https://github.com/magnitus99/Superpower-Inside/actions"
