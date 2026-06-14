#!/usr/bin/env fish
# 태그 간 커밋 로그 기반 릴리즈 노트 생성
# 사용법:
#   ./scripts/release-notes.fish <current-tag> [prev-tag] [output-file]

set CURRENT_TAG $argv[1]
if test -z "$CURRENT_TAG"
    echo "ERROR: 사용법: ./scripts/release-notes.fish <current-tag> [prev-tag] [output-file]"
    exit 1
end

if not git rev-parse -q "$CURRENT_TAG" >/dev/null 2>&1
    echo "ERROR: 태그 또는 커밋 '$CURRENT_TAG'를 찾을 수 없습니다."
    exit 1
end

set PREV_TAG $argv[2]
if test -z "$PREV_TAG"
    set PREV_TAG ""
    for tag in (git tag --sort=version:refname --list)
        if test "$tag" = "$CURRENT_TAG"
            break
        end
        set PREV_TAG "$tag"
    end

    if test -z "$PREV_TAG"
        echo "ERROR: 이전 태그를 자동 탐색하지 못했습니다."
        echo "이전 태그를 명시해서 실행하세요."
        echo "예: ./scripts/release-notes.fish $CURRENT_TAG v1.2.3"
        exit 1
    end
end

set OUTPUT_FILE $argv[3]
if test -z "$OUTPUT_FILE"
    set OUTPUT_FILE "release-notes-$CURRENT_TAG.md"
end

set RANGE "$PREV_TAG..$CURRENT_TAG"
set RAW_COMMITS (git log --no-merges --pretty=format:'%h %s' "$RANGE")
set COMMIT_COUNT (count $RAW_COMMITS)

if test "$COMMIT_COUNT" -eq 0
    echo "WARNING: $PREV_TAG..$CURRENT_TAG 구간에 커밋이 없습니다."
    exit 0
end

set FEATURES
set FIXES
set PERFORMANCE
set DOCUMENTATION
set CHORES
set OTHERS

for line in $RAW_COMMITS
    set hash (string split " " -- $line)[1]
    set msg (string join " " -- (string split " " -- $line)[2..-1])
    set msg_lc (string lower "$msg")

    if string match -r '^(feat|feature)(\(.*\))?:' "$msg_lc"
        set FEATURES $FEATURES "- `$hash` $msg"
    else if string match -r '^(fix|bug|patch)(\(.*\))?:' "$msg_lc"
        set FIXES $FIXES "- `$hash` $msg"
    else if string match -r '^(perf|performance)(\(.*\))?:' "$msg_lc"
        set PERFORMANCE $PERFORMANCE "- `$hash` $msg"
    else if string match -r '^(docs|doc|readme)(\(.*\))?:' "$msg_lc"
        set DOCUMENTATION $DOCUMENTATION "- `$hash` $msg"
    else if string match -r '^(chore|build|ci|refactor|test|style|revert)(\(.*\))?:' "$msg_lc"
        set CHORES $CHORES "- `$hash` $msg"
    else
        set OTHERS $OTHERS "- `$hash` $msg"
    end
end

printf '# %s\n\n' "Release $CURRENT_TAG" > "$OUTPUT_FILE"
printf '- 이전 버전: %s\n' "$PREV_TAG" >> "$OUTPUT_FILE"
printf '- 커밋 범위: %s\n' "$RANGE" >> "$OUTPUT_FILE"
printf '- 반영 커밋 수: %s\n\n' "$COMMIT_COUNT" >> "$OUTPUT_FILE"

printf '## 주요 변경사항\n\n' >> "$OUTPUT_FILE"
if test (count $FEATURES) -gt 0
    for item in $FEATURES
        printf '%s\n' "$item" >> "$OUTPUT_FILE"
    end
    printf '\n' >> "$OUTPUT_FILE"
else
    printf '_특이사항 없음_\n\n' >> "$OUTPUT_FILE"
end

printf '## 버그 수정\n\n' >> "$OUTPUT_FILE"
if test (count $FIXES) -gt 0
    for item in $FIXES
        printf '%s\n' "$item" >> "$OUTPUT_FILE"
    end
    printf '\n' >> "$OUTPUT_FILE"
else
    printf '_특이사항 없음_\n\n' >> "$OUTPUT_FILE"
end

printf '## 성능 / 안정성 / 운영 개선\n\n' >> "$OUTPUT_FILE"
if test (count $PERFORMANCE) -gt 0
    for item in $PERFORMANCE
        printf '%s\n' "$item" >> "$OUTPUT_FILE"
    end
    printf '\n' >> "$OUTPUT_FILE"
else
    printf '_특이사항 없음_\n\n' >> "$OUTPUT_FILE"
end

printf '## 문서 / 기타\n\n' >> "$OUTPUT_FILE"
set MISC_LINES $DOCUMENTATION $CHORES $OTHERS
if test (count $MISC_LINES) -gt 0
    for item in $MISC_LINES
        printf '%s\n' "$item" >> "$OUTPUT_FILE"
    end
else
    printf '_특이사항 없음_\n' >> "$OUTPUT_FILE"
end

printf '\n'
echo "✅ 릴리즈 노트 생성 완료: $OUTPUT_FILE"
echo "GitHub 릴리스 명령 예시:"
echo "gh release create $CURRENT_TAG --title \"Release $CURRENT_TAG\" --notes-file \"$OUTPUT_FILE\""
cat "$OUTPUT_FILE"
