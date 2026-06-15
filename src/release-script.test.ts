import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

describe('릴리스 스크립트 브랜치 정책', () => {
  it('버전 커밋과 태그 생성은 main 브랜치에서만 허용한다', () => {
    const script = readFileSync(resolve(root, 'scripts/bump-version.fish'), 'utf8');

    expect(script).toContain('set REQUIRED_RELEASE_BRANCH main');
    expect(script).toContain('if test "$CURRENT_BRANCH" != "$REQUIRED_RELEASE_BRANCH"');
    expect(script).not.toContain('main 브랜치에서 직접 릴리스 커밋을 만들 수 없습니다');
  });

  it('릴리스 노트 이전 태그 계산은 legacy v-prefix 태그를 제외한다', () => {
    const script = readFileSync(resolve(root, 'scripts/bump-version.fish'), 'utf8');

    expect(script).toContain("git tag --sort=version:refname --list '[0-9]*'");
    expect(script).toContain('if test "$RELEASE_TAGS[$index]" = "$NEW_VERSION"');
    expect(script).not.toContain('set PREV_TAG $TAGS[(math $TAG_COUNT - 1)]');
  });
});
