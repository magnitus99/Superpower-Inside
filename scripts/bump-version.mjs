#!/usr/bin/env node
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { capture, npm, run } from './script-process.mjs';

const root = process.cwd();
const options = { cwd: root };
const usage = '사용법: node scripts/bump-version.mjs [patch|minor|major]';
let bumpType = 'patch';
for (const arg of process.argv.slice(2)) {
  if (arg === '-h' || arg === '--help') {
    console.log(`${usage}\n기본값: patch`);
    process.exit(0);
  }
  if (!['patch', 'minor', 'major'].includes(arg)) {
    console.log(`ERROR: 유효하지 않은 인자 '${arg}'\n${usage}`);
    process.exit(1);
  }
  bumpType = arg;
}

const branch = capture('git', ['branch', '--show-current'], options).trim();
if (branch !== 'dev') {
  console.log(`ERROR: 버전 커밋은 dev 브랜치에서만 만들 수 있습니다. 현재 브랜치: ${branch}`);
  console.log('기능 구현은 기능 브랜치에서 dev로 merge하고, 릴리스는 dev에서 준비한 뒤 main으로 squash merge합니다.');
  process.exit(1);
}
if (capture('git', ['status', '--porcelain'], options).trim()) {
  console.log('ERROR: 릴리스 준비 전에 작업 변경을 검토하고 커밋하세요.');
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(join(root, file), 'utf8'));
}

function writeJson(file, value) {
  const output = join(root, file);
  const tmp = `${output}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  try {
    renameSync(tmp, output);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

const manifest = readJson('manifest.json');
const currentVersion = manifest.version;
if (typeof currentVersion !== 'string' || currentVersion.trim() !== currentVersion || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(currentVersion)) {
  console.log(`ERROR: manifest.json 버전이 SemVer x.y.z 형식이 아닙니다: ${currentVersion}`);
  process.exit(1);
}
const [major, minor, patch] = currentVersion.split('.').map(BigInt);
const version = bumpType === 'major' ? `${major + 1n}.0.0`
  : bumpType === 'minor' ? `${major}.${minor + 1n}.0`
  : `${major}.${minor}.${patch + 1n}`;
const pkg = readJson('package.json');
const versions = readJson('versions.json');
if (typeof manifest.minAppVersion !== 'string' || !manifest.minAppVersion) {
  console.error('ERROR: manifest.json minAppVersion을 확인할 수 없습니다.');
  process.exit(1);
}

console.log(`새 버전: ${version}`);
writeJson('manifest.json', { ...manifest, version });
writeJson('package.json', { ...pkg, version });
writeJson('versions.json', { ...versions, [version]: manifest.minAppVersion });
npm(['install', '--package-lock-only', '--ignore-scripts'], options);
npm(['run', 'release:check'], options);

const pluginAssets = [
  'main.js', 'tern_engine_bg.wasm', 'embeddinggemma-worker.js', 'pdf-worker.js',
  'pdf-ocr-worker.js', 'embeddinggemma-runtime.wasm', 'embeddinggemma-runtime.mjs',
];
run('git', [
  'add', 'manifest.json', 'package.json', 'package-lock.json', 'versions.json', 'styles.css',
  'THIRD_PARTY_NOTICES.md', ARTIFACT_PATHS.generated,
  ...pluginAssets.map((asset) => `${ARTIFACT_PATHS.plugin}/${asset}`),
], options);
run('git', ['commit', '-m', `chore(release): ${version}`], options);

console.log('릴리스 커밋이 dev에 준비되었습니다.');
console.log('다음: dev를 main으로 squash merge하는 PR을 만들고, main에서 npm run release:tag로 태그를 생성하세요.');
