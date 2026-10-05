import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });
if (git('rev-parse', '--git-dir').status === 0) {
  const configured = git('config', '--get', 'core.hooksPath').stdout.trim();
  const defaults = git('rev-parse', '--git-path', 'hooks').stdout.trim();
  if (configured && configured !== '.githooks')
    throw new Error(`기존 훅 설정을 보존합니다. 통합이 필요합니다: ${configured}`);
  for (const name of ['pre-commit', 'pre-push']) {
    const existing = resolve(defaults, name);
    if (!configured && existsSync(existing) && readFileSync(existing, 'utf8').trim()) {
      throw new Error(`기존 훅을 보존합니다. 통합이 필요합니다: ${existing}`);
    }
    chmodSync(resolve('.githooks', name), 0o755);
  }
  chmodSync(resolve('scripts/patina-bin/codex'), 0o755);
  const result = git('config', '--local', 'core.hooksPath', '.githooks');
  if (result.status !== 0) throw new Error(result.stderr);
  console.log('Patina pre-commit / pre-push 훅을 설치했습니다.');
}
