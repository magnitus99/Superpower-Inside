#!/usr/bin/env fish
# 버전을 올리고 git 태그를 생성한 뒤 푸시하는 스크립트
# 사용법: ./scripts/bump-version.fish [patch|minor|major]
# 기본값: patch

set BUMP_TYPE $argv[1]
if test -z "$BUMP_TYPE"
    set BUMP_TYPE patch
end

if not contains "$BUMP_TYPE" patch minor major
    echo "ERROR: 유효하지 않은 버전 타입 '$BUMP_TYPE'"
    echo "사용법: ./scripts/bump-version.fish [patch|minor|major]"
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

# 빌드
npm run build
or begin
    echo "ERROR: 빌드 실패"
    exit 1
end

# 커밋
git add manifest.json package.json main.js
and git commit -m "chore(release): v$NEW_VERSION"
or begin
    echo "ERROR: git commit 실패"
    exit 1
end

# 태그 생성
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
or begin
    echo "ERROR: git tag 생성 실패"
    exit 1
end

# 푸시
git push origin main
and git push origin "v$NEW_VERSION"
or begin
    echo "ERROR: git push 실패"
    exit 1
end

echo ""
echo "✅ v$NEW_VERSION 릴리스 완료!"
echo "GitHub Actions가 자동으로 릴리스를 생성합니다."
echo "https://github.com/magnitus99/Super-Obsidian-by-AI/actions"
