import { readFileSync, writeFileSync } from 'node:fs';
import { runCommand, scriptMain } from './script-process.mjs';

export function bumpVersion(args = process.argv.slice(2)) {
  let bump = 'patch';
  for (const arg of args) {
    if (['patch', 'minor', 'major'].includes(arg)) bump = arg;
    else if (arg === '--no-release')
      console.log('WARN: --no-release 옵션은 더 이상 사용하지 않습니다.');
    else if (['-h', '--help'].includes(arg)) {
      console.log('사용법: node scripts/bump-version.mjs [patch|minor|major]');
      return;
    } else throw new Error(`유효하지 않은 인자: ${arg}`);
  }
  const git = (args) => runCommand('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  const branch = git(['branch', '--show-current']);
  const requiredReleaseBranch = 'main';
  if (branch !== requiredReleaseBranch)
    throw new Error(
      `버전 커밋과 릴리스 태그는 main 브랜치에서만 만들 수 있습니다. 현재 브랜치: ${branch}`,
    );
  if (git(['status', '--porcelain']))
    throw new Error('릴리스 준비 전에 작업 변경을 검토하고 커밋하세요.');
  const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const manifest = readJson('manifest.json');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error('릴리스 버전 형식이 잘못되었습니다.');
  const parts = manifest.version.split('.').map(Number);
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  parts[index]++;
  for (let next = index + 1; next < parts.length; next++) parts[next] = 0;
  const version = parts.join('.');
  const packageJson = readJson('package.json');
  const versions = readJson('versions.json');
  manifest.version = packageJson.version = version;
  versions[version] = manifest.minAppVersion;
  for (const [file, value] of [
    ['manifest.json', manifest],
    ['package.json', packageJson],
    ['versions.json', versions],
  ])
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  runCommand('npm', ['install', '--package-lock-only', '--ignore-scripts']);
  runCommand('npm', ['run', 'release:check']);
  runCommand('git', [
    'add',
    'manifest.json',
    'package.json',
    'package-lock.json',
    'versions.json',
    'main.js',
    'styles.css',
    'tern_engine_bg.wasm',
    'THIRD_PARTY_NOTICES.md',
    'generated',
    'src/rag/rag-wasm-bytes.ts',
    'embeddinggemma-worker.js',
    'embeddinggemma-runtime.wasm',
    'embeddinggemma-runtime.mjs',
  ]);
  runCommand('git', ['commit', '-m', `chore(release): ${version}`]);
  runCommand('git', ['tag', '-a', version, '-m', `Release ${version}`]);
  runCommand('git', ['push', 'origin', branch]);
  runCommand('git', ['push', 'origin', version]);
  console.log('release-notes-*.md 문서는 생성하지 않습니다.');
  console.log('GitHub Release가 생성되면 릴리즈 요약을 본문에 직접 붙여 넣으세요.');
}

scriptMain(import.meta.url, () => bumpVersion());
