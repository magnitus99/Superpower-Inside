#!/usr/bin/env fish
# 버전을 올리고 Obsidian 커뮤니티 제출 규칙에 맞는 git 태그를 생성한 뒤 푸시하는 스크립트
# 사용법: ./scripts/bump-version.fish [patch|minor|major]
# 기본값: patch

set BUMP_TYPE patch

for ARG in $argv
    switch "$ARG"
        case patch minor major
            set BUMP_TYPE "$ARG"
        case --no-release
            echo "WARN: --no-release 옵션은 더 이상 사용하지 않습니다. release-notes 문서는 만들지 말고 GitHub Release 본문에 릴리즈 요약을 직접 붙여 넣으세요."
        case -h --help
            echo "사용법: ./scripts/bump-version.fish [patch|minor|major]"
            echo "기본값: patch"
            echo "release-notes 문서는 생성하지 않습니다. 필요한 제품 설명은 README.md에 통합하고, 릴리즈 요약은 GitHub Release 본문에 직접 붙여 넣으세요."
            exit 0
        case '*'
            echo "ERROR: 유효하지 않은 인자 '$ARG'"
            echo "사용법: ./scripts/bump-version.fish [patch|minor|major]"
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
git add manifest.json package.json package-lock.json versions.json main.js styles.css tern_engine_bg.wasm THIRD_PARTY_NOTICES.md scripts/validate-obsidian-review.mjs scripts/bundle-size-policy.mjs scripts/bundle-size-policy.test.mjs .github/workflows/release.yml scripts/bump-version.fish scripts/install-rust-security-tools.fish scripts/patch-rag-wasm-dts.mjs scripts/build-rag-wasm.fish scripts/copy-ternlight-assets.fish generated/rag-wasm/rag_wasm.d.ts README.md esbuild.config.mjs
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

echo "INFO: release-notes-*.md 문서는 생성하지 않습니다. 릴리즈 요약은 GitHub Release 본문에 직접 붙여 넣고, 필요한 제품 설명은 README.md에 현재형으로 통합하세요."

# 푸시
git push origin "$CURRENT_BRANCH"
and git push origin "$NEW_VERSION"
or begin
    echo "ERROR: git push 실패"
    exit 1
end

echo ""
echo "✅ $NEW_VERSION 릴리스 완료!"
echo "GitHub Actions가 자동으로 릴리스를 생성합니다."
echo "GitHub Release가 생성되면 릴리즈 요약을 본문에 직접 붙여 넣으세요. release-notes 파일은 커밋하지 않습니다."
echo "https://github.com/magnitus99/Superpower-Inside/actions"
