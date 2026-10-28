#!/usr/bin/env fish
# main의 squash merge 커밋에 릴리스 태그를 만듭니다. main에는 직접 커밋하지 않습니다.
set CURRENT_BRANCH (git branch --show-current)
if test "$CURRENT_BRANCH" != main
    echo "ERROR: 릴리스 태그는 main 브랜치에서만 만들 수 있습니다. 현재 브랜치: $CURRENT_BRANCH"
    exit 1
end

if test (count (git status --porcelain)) -gt 0
    echo "ERROR: 태그를 만들기 전에 작업 변경을 정리하세요."
    exit 1
end

git fetch --no-tags origin main dev
or exit $status

set VERSION (jq -r '.version' manifest.json)
if not string match -rq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -- "$VERSION"
    echo "ERROR: manifest.json 버전이 SemVer x.y.z 형식이 아닙니다: $VERSION"
    exit 1
end

if git rev-parse --verify --quiet "refs/tags/$VERSION" >/dev/null
    echo "ERROR: 태그 $VERSION가 이미 있습니다."
    exit 1
end

node scripts/check-branch-policy.mjs --release-tag "$VERSION"
or exit $status

git tag -a "$VERSION" -m "release: $VERSION"
or exit $status

node scripts/check-branch-policy.mjs --push-tag "$VERSION"
or exit $status

echo "릴리스 태그 $VERSION를 만들었습니다."
echo "검토 후 git push origin $VERSION 로 태그를 푸시하세요. 푸시가 GitHub Release 초안을 만듭니다."
