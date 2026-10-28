#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * PR의 base/head 조합이 브랜치 계약을 지키는지 판정합니다.
 * main은 dev에서만 squash merge하고, dev는 기능 브랜치에서만 받습니다.
 * @param {{ baseRef: string, headRef: string }} input PR 브랜치
 * @returns {string | null} 위반 사유, 없으면 null
 */
export function pullRequestProblem({ baseRef, headRef }) {
  if (!baseRef || !headRef) return 'PR의 base/head 브랜치를 확인할 수 없습니다.';
  if (baseRef === 'main' && headRef !== 'dev')
    return `main에는 dev 브랜치만 squash merge할 수 있습니다. 현재 head: ${headRef}`;
  if (baseRef === 'dev' && (headRef === 'main' || headRef === 'dev'))
    return `dev에는 기능 브랜치만 merge할 수 있습니다. 현재 head: ${headRef}`;
  return null;
}

/**
 * 릴리스 태그가 main의 현재 커밋이고 dev와 내용이 같은지 판정합니다.
 * @param {{ tag: string, version: string, head: string, mainHead: string, treeMatchesDev: boolean, tagOnMain: boolean }} input 릴리스 상태
 * @returns {string[]} 위반 사유
 */
export function releaseProblems({ tag, version, head, mainHead, treeMatchesDev, tagOnMain }) {
  const problems = [];
  if (tag !== version) problems.push(`태그 ${tag}와 manifest 버전 ${version}이 다릅니다.`);
  if (!tagOnMain) problems.push('태그 커밋이 main 이력에 없습니다.');
  if (mainHead !== head) problems.push('main의 최신 커밋이 태그 커밋과 다릅니다.');
  if (!treeMatchesDev) problems.push('main과 dev의 내용이 다릅니다. dev를 먼저 squash merge하세요.');
  return problems;
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(result.stderr.trim() || 'git 실패');
  return result.status === 0 ? result.stdout.trim() : null;
}

function version() {
  return JSON.parse(readFileSync(resolve('manifest.json'), 'utf8')).version;
}

function pr() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event !== 'pull_request' && event !== 'merge_group') {
    console.log('브랜치 정책: PR 이벤트가 아니어서 건너뜁니다.');
    return;
  }
  if (event === 'merge_group') {
    const base = process.env.GITHUB_BASE_REF || 'dev';
    console.log(`브랜치 정책: merge queue base ${base}를 확인했습니다.`);
    return;
  }
  const problem = pullRequestProblem({
    baseRef: process.env.GITHUB_BASE_REF,
    headRef: process.env.GITHUB_HEAD_REF,
  });
  if (problem) throw new Error(problem);
  console.log('브랜치 정책: PR 대상과 소스 브랜치가 계약을 지킵니다.');
}

function pushTag(tag) {
  if (!tag) throw new Error('--push-tag에는 태그 이름이 필요합니다.');
  const current = version();
  if (tag !== current) throw new Error(`태그 ${tag}와 manifest 버전 ${current}이 다릅니다.`);
  const branch = git(['branch', '--show-current']);
  if (branch !== 'main') throw new Error(`릴리스 태그는 main에서만 만들 수 있습니다. 현재: ${branch}`);
  if (!git(['rev-parse', '--verify', '--quiet', 'origin/dev'], { allowFailure: true }))
    throw new Error('origin/dev가 없습니다. dev 브랜치를 먼저 push하세요.');
  const head = git(['rev-parse', 'HEAD']);
  if (git(['diff', '--quiet', 'origin/dev', head], { allowFailure: true }) === null)
    throw new Error('main과 dev의 내용이 다릅니다. dev를 먼저 squash merge하세요.');
  const tagSha = git(['rev-parse', `refs/tags/${tag}^{commit}`], { allowFailure: true });
  if (!tagSha) throw new Error(`태그 ${tag}가 아직 없습니다.`);
  if (tagSha !== head) throw new Error(`태그 ${tag}가 현재 main HEAD와 다릅니다.`);
  console.log(`브랜치 정책: 릴리스 태그 ${tag}가 main HEAD를 가리킵니다.`);
}

function releaseTag(tag) {
  if (!tag) throw new Error('--release-tag에는 태그 이름이 필요합니다.');
  for (const ref of ['origin/main', 'origin/dev']) {
    if (!git(['rev-parse', '--verify', '--quiet', ref], { allowFailure: true }))
      throw new Error(`${ref}가 없습니다. main·dev를 fetch한 뒤 다시 실행하세요.`);
  }
  const head = git(['rev-parse', 'HEAD']);
  const mainHead = git(['rev-parse', 'origin/main']);
  const tagOnMain = git(['merge-base', '--is-ancestor', head, 'origin/main'], {
    allowFailure: true,
  });
  const treeMatchesDev =
    git(['diff', '--quiet', 'origin/dev', head], { allowFailure: true }) !== null;
  const problems = releaseProblems({
    tag,
    version: version(),
    head,
    mainHead,
    treeMatchesDev,
    tagOnMain: tagOnMain !== null,
  });
  if (problems.length > 0) throw new Error(problems.join('\n'));
  console.log(`브랜치 정책: ${tag} 릴리스가 main과 dev의 공통 내용을 가리킵니다.`);
}

function run() {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (mode === '--pr') pr();
  else if (mode === '--push-tag') pushTag(args[1]);
  else if (mode === '--release-tag') releaseTag(args[1]);
  else
    throw new Error(
      '사용법: node scripts/check-branch-policy.mjs --pr | --push-tag <태그> | --release-tag <태그>',
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
