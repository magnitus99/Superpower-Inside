#!/usr/bin/env node
import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { root, run } from './script-process.mjs';

const target = join(root, ARTIFACT_PATHS.plugin);
const vault = join(root, '.test-vault');
const link = join(vault, '.obsidian', 'plugins', 'superpower-inside');
const hotReload = join(dirname(link), 'hot-reload');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const stat = (path) => statSync(path, { throwIfNoEntry: false });
if (!stat(join(target, 'main.js'))?.isFile() || !stat(join(target, 'manifest.json'))?.isFile()) {
  fail(`먼저 npm run build:dev로 플러그인을 빌드하세요: ${target}`);
}

if (stat(vault)?.isDirectory()) {
  console.log(`✅ 테스트 볼트가 이미 존재합니다: ${vault}`);
} else {
  mkdirSync(vault);
  writeFileSync(join(vault, 'Welcome.md'), '# Test Vault\n\nThis vault is for developing the Superpower Inside plugin.\n', { flag: 'wx' });
  console.log('✅ 테스트 볼트 생성 완료');
}

const existing = lstatSync(link, { throwIfNoEntry: false });
if (existing?.isSymbolicLink()) {
  if (!stat(link) || realpathSync(link) !== realpathSync(target)) {
    fail(`기존 플러그인 연결이 다른 경로를 가리킵니다. 연결만 직접 제거한 뒤 setup을 다시 실행하여 재설정하세요: ${link} → ${target}`);
  }
  console.log('✅ 플러그인 연결이 이미 존재합니다');
} else if (existing) {
  fail(`플러그인 경로가 이미 존재합니다. 원본을 보존하고 경로를 직접 재설정하세요: ${link}`);
} else {
  mkdirSync(dirname(link), { recursive: true });
  // Windows directory junctions do not require developer mode or symlink privileges.
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`✅ 플러그인 연결 생성 완료: ${link} → ${target}`);
}

if (stat(hotReload)?.isDirectory()) {
  console.log('✅ hot-reload 플러그인이 이미 설치되어 있습니다');
} else {
  run('git', ['clone', '--depth', '1', 'https://github.com/pjeby/hot-reload.git', hotReload]);
  console.log('✅ hot-reload 설치 완료');
}

const ignore = join(root, '.gitignore');
if (!stat(ignore) || !readFileSync(ignore, 'utf8').split(/\r?\n/).some((line) => line.startsWith('.test-vault/'))) {
  appendFileSync(ignore, '\n# --- Test vault ---\n.test-vault/\n');
  console.log('✅ .gitignore에 .test-vault/ 추가 완료');
}

console.log(`
🎉 개발 환경 설정 완료!
테스트 볼트: ${vault}
플러그인 연결: ${link} → ${target}

다음 단계:
  1. npm run dev (esbuild watch 시작)
  2. node scripts/launch-obsidian-debug.mjs (Obsidian 디버그 모드 실행)
  3. Obsidian에서 테스트 볼트 열기
  4. 설정 → 커뮤니티 플러그인 → hot-reload 활성화
  5. 설정 → 커뮤니티 플러그인 → Superpower Inside 활성화
`);
