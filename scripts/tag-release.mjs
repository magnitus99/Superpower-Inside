#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { capture, run } from './script-process.mjs';

const options = { cwd: process.cwd() };

// main의 squash merge 커밋에만 태그를 만들고, 직접 커밋하거나 푸시하지 않습니다.
const branch = capture('git', ['branch', '--show-current'], options).trim();
if (branch !== 'main') {
  console.log(`ERROR: 릴리스 태그는 main 브랜치에서만 만들 수 있습니다. 현재 브랜치: ${branch}`);
  process.exit(1);
}
if (capture('git', ['status', '--porcelain'], options).trim()) {
  console.log('ERROR: 태그를 만들기 전에 작업 변경을 정리하세요.');
  process.exit(1);
}

run('git', ['fetch', '--no-tags', 'origin', 'main', 'dev'], options);
const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (typeof version !== 'string' || version.trim() !== version || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
  console.log(`ERROR: manifest.json 버전이 SemVer x.y.z 형식이 아닙니다: ${version}`);
  process.exit(1);
}
if (capture('git', ['tag', '--list', version], options).trim()) {
  console.log(`ERROR: 태그 ${version}가 이미 있습니다.`);
  process.exit(1);
}

run(process.execPath, ['scripts/check-branch-policy.mjs', '--release-tag', version], options);
run('git', ['tag', '-a', version, '-m', `release: ${version}`], options);
run(process.execPath, ['scripts/check-branch-policy.mjs', '--push-tag', version], options);

console.log(`릴리스 태그 ${version}를 만들었습니다.`);
console.log(`검토 후 git push origin ${version} 로 태그를 푸시하세요. 푸시가 GitHub Release 초안을 만듭니다.`);
