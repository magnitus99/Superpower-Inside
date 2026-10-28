import { describe, expect, it } from 'vitest';
import { pullRequestProblem, releaseProblems } from './check-branch-policy.mjs';

describe('브랜치 정책', () => {
  it('main에는 dev만 squash merge한다', () => {
    expect(pullRequestProblem({ baseRef: 'main', headRef: 'dev' })).toBeNull();
    expect(pullRequestProblem({ baseRef: 'main', headRef: 'feature/search' })).toContain('dev');
  });

  it('dev는 main이나 dev 자신을 받지 않는다', () => {
    expect(pullRequestProblem({ baseRef: 'dev', headRef: 'feature/search' })).toBeNull();
    expect(pullRequestProblem({ baseRef: 'dev', headRef: 'main' })).toContain('기능 브랜치');
    expect(pullRequestProblem({ baseRef: 'dev', headRef: 'dev' })).toContain('기능 브랜치');
  });

  it('base/head가 없으면 통과로 처리하지 않는다', () => {
    expect(pullRequestProblem({ baseRef: '', headRef: 'dev' })).toContain('확인할 수 없습니다');
  });

  it('릴리스 태그는 버전·main HEAD·dev 내용이 모두 일치해야 한다', () => {
    const valid = {
      tag: '3.5.0',
      version: '3.5.0',
      head: 'a',
      mainHead: 'a',
      treeMatchesDev: true,
      tagOnMain: true,
    };
    expect(releaseProblems(valid)).toEqual([]);
    expect(releaseProblems({ ...valid, tag: 'v3.5.0' })).toContain(
      '태그 v3.5.0와 manifest 버전 3.5.0이 다릅니다.',
    );
    expect(releaseProblems({ ...valid, mainHead: 'b' })).toContain(
      'main의 최신 커밋이 태그 커밋과 다릅니다.',
    );
    expect(releaseProblems({ ...valid, treeMatchesDev: false })).toContain(
      'main과 dev의 내용이 다릅니다. dev를 먼저 squash merge하세요.',
    );
    expect(releaseProblems({ ...valid, tagOnMain: false })).toContain(
      '태그 커밋이 main 이력에 없습니다.',
    );
  });
});
