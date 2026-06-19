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

  it('릴리스 스크립트는 release-notes 파일 대신 GitHub Release 본문 작성을 안내한다', () => {
    const script = readFileSync(resolve(root, 'scripts/bump-version.fish'), 'utf8');

    expect(script).toContain('release-notes-*.md 문서는 생성하지 않습니다');
    expect(script).toContain('GitHub Release가 생성되면 릴리즈 요약을 본문에 직접 붙여 넣으세요');
    expect(script).not.toContain('./scripts/release-notes.fish');
    expect(script).not.toContain('--notes-file');
    expect(script).not.toContain("git tag --sort=version:refname --list '[0-9]*'");
  });
});
