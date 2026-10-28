#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(result.stderr.trim());
  return result.status === 0 ? result.stdout.trim() : null;
}

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${program} ${args.join(' ')} 실패`);
}

function mergeBase() {
  for (const ref of ['origin/dev', 'origin/main', 'main']) {
    if (git(['rev-parse', '--verify', '--quiet', ref], { allowFailure: true })) {
      const base = git(['merge-base', 'HEAD', ref], { allowFailure: true });
      if (base) return base;
    }
  }
  return 'HEAD';
}

function baseFor(remoteSha) {
  if (remoteSha && !/^0+$/.test(remoteSha) && git(['cat-file', '-e', `${remoteSha}^{commit}`], { allowFailure: true }))
    return remoteSha;
  return mergeBase();
}

function main() {
  const input = readFileSync(0, 'utf8').trim();
  if (!input) return;
  const updates = input
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({
      localRef,
      localSha,
      remoteRef,
      remoteSha,
    }));
  const branchUpdates = updates.filter(
    (update) => update.remoteRef.startsWith('refs/heads/') && !/^0+$/.test(update.localSha),
  );
  const tagUpdates = updates.filter(
    (update) => update.remoteRef.startsWith('refs/tags/') && !/^0+$/.test(update.localSha),
  );
  if (branchUpdates.some((update) => update.remoteRef === 'refs/heads/main'))
    throw new Error('main에는 직접 push할 수 없습니다. dev에서 squash merge PR을 사용하세요.');
  for (const update of tagUpdates) {
    const tag = update.remoteRef.slice('refs/tags/'.length);
    run(process.execPath, [
      resolve('scripts/check-branch-policy.mjs'),
      '--push-tag',
      tag,
    ]);
  }
  if (branchUpdates.length > 0) {
    const base = baseFor(branchUpdates[0].remoteSha);
    console.log(`pre-push: ${base} 이후 변경 범위를 검사합니다.`);
    run(process.execPath, [resolve('scripts/check-quality.mjs'), '--base', base]);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
