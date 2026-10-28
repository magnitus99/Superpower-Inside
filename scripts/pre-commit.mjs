#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${program} ${args.join(' ')} 실패`);
}

try {
  // 커밋 전에는 스테이징된 diff 형식과 로컬 볼트 유출만 확인합니다.
  run('git', ['diff', '--cached', '--check']);
  run(process.execPath, [resolve('scripts/check-vault-leakage.mjs'), '--staged']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
