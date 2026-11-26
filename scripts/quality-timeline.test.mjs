import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { qualityPlan } from './check-quality.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(repository, path), 'utf8');

// Synthetic process boundary: no fallthrough to real Git, npm or Obsidian.
function fixture(script, mode = '') {
  const fixtures = join(repository, '.thinkrail/context/_release-script-tests');
  mkdirSync(fixtures, { recursive: true });
  const root = mkdtempSync(join(fixtures, 'fixture & '));
  const scripts = join(root, 'scripts');
  const outside = join(root, 'caller');
  mkdirSync(scripts);
  mkdirSync(outside);
  for (const file of [script, 'artifact-paths.mjs']) copyFileSync(join(repository, 'scripts', file), join(scripts, file));
  writeFileSync(join(scripts, 'script-process.mjs'), `
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.env.FIXTURE_MODE;
function log(command, args, { cwd = root } = {}) {
  appendFileSync(join(root, 'calls'), JSON.stringify({ command, args, cwd }) + '\\n');
}
export function capture(command, args, options) {
  log(command, args, options);
  if (command !== 'git') throw new Error(command);
  if (args[0] === 'branch') return mode === 'wrong-branch' ? 'feature\\n' : '${script === 'tag-release.mjs' ? 'main' : 'dev'}\\n';
  if (args[0] === 'status') {
    if (mode === 'git-error') process.exit(23);
    return mode === 'dirty' ? '?? first.txt\\r\\n?? second.txt\\r\\n' : '';
  }
  if (args[0] === 'tag' && args[1] === '--list') return mode === 'existing-tag' ? '1.2.3\\n' : '';
  throw new Error(args.join(' '));
}
export function run(command, args, options) {
  log(command === process.execPath ? 'node' : command, args, options);
  if (args[0] === 'fetch' && mode === 'fetch-fails') process.exit(18);
  if (args[0] === 'add' && mode === 'stage-fails') process.exit(16);
  if (args.includes('--release-tag') && mode === 'denied') process.exit(19);
  if (args.includes('--push-tag') && mode === 'post-tag-denied') process.exit(21);
  if (args[0] === 'clone') {
    if (mode === 'clone-fails') process.exit(14);
    mkdirSync(args.at(-1));
  }
  if (command !== 'git' && command !== process.execPath) process.exit(17);
}
export function npm(args, options) {
  log('npm', args, options);
  if (args[1] === mode) process.exit(7);

}
`);
  const processEnv = {};
  if (script === 'check-release.mjs') {
    // Exercise the real helper with a fake npm CLI (also shell-free on Windows).
    for (const file of ['script-process.mjs', 'run-node-tool.mjs']) {
      copyFileSync(join(repository, 'scripts', file), join(scripts, file));
    }
    processEnv.npm_execpath = join(scripts, 'fake npm & cli.mjs');
    writeFileSync(processEnv.npm_execpath, `
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync('calls', JSON.stringify({ command: 'npm', args, cwd: process.cwd() }) + '\\n');
if (args[1] === process.env.FIXTURE_MODE) process.exit(7);
if (args[1] === 'build') writeFileSync('manifest.json', '{"version":"2.3.4"}');
`);
  }
  const json = (file, value) => writeFileSync(join(root, file), JSON.stringify(value));
  json('manifest.json', { version: '1.2.3', minAppVersion: '1.7.0', name: 'Fixture' });
  json('package.json', { version: '1.2.3', private: true });
  json('versions.json', { '1.2.3': '1.6.0' });
  return {
    root, json,
    read: (file) => readFileSync(join(root, file), 'utf8'),
    run: (args = [], nodeArgs = [], env = {}) => spawnSync(process.execPath, [
      ...nodeArgs, join(scripts, script), ...args,
    ], {
      cwd: ['bump-version.mjs', 'tag-release.mjs', 'check-release.mjs'].includes(script) ? root : outside,
      encoding: 'utf8', env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath')),
        ...processEnv, FIXTURE_MODE: mode, ...env,
      },
    }),
    calls: () => existsSync(join(root, 'calls'))
      ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').map(JSON.parse)
      : [],
  };
}

describe('검사 시점과 중복 제거', () => {
  it('검색 품질 fixture 변경은 전체 테스트를 선택한다', () => {
    expect(qualityPlan(['src/rag/search-quality-gate.test.ts']).tests).toBe(true);
  });

  it.each(['wrong-branch', 'dirty', 'git-error'])('버전과 태그를 변경하기 전에 %s를 거절한다', (mode) => {
    for (const script of ['bump-version.mjs', 'tag-release.mjs']) {
      const f = fixture(script, mode);
      const before = f.read('manifest.json');
      const result = f.run();
      expect(result.status, result.stderr).toBe(mode === 'git-error' ? 23 : 1);
      expect(f.calls().map(({ args }) => args[0])).toEqual(mode === 'wrong-branch' ? ['branch'] : ['branch', 'status']);
      expect(f.read('manifest.json')).toBe(before);
    }
  });

  it.each(['security:full', 'build', 'review', ''])('릴리스 각 단계의 순서와 실패 코드를 유지한다 (%s)', (failed) => {
    const f = fixture('check-release.mjs', failed);
    const order = [['run', 'security:full'], ['run', 'build'], ['run', 'review', '--', '--tag', '2.3.4', '--built']];
    const result = f.run();
    expect(result.status, result.stderr).toBe(failed ? 7 : 0);
    const expected = failed ? order.slice(0, order.findIndex((args) => args[1] === failed) + 1) : order;
    expect(f.calls().map(({ command, args, cwd }) => ({ command, args, cwd: resolve(cwd) })))
      .toEqual(expected.map((args) => ({ command: 'npm', args, cwd: f.root })));
  });

  it.each([['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']])('합성 %s 범프는 정확한 파일과 단계만 사용한다', (type, version) => {
    const f = fixture('bump-version.mjs');
    const result = f.run(type === 'patch' ? [] : [type]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(f.read('manifest.json'))).toEqual({ version, minAppVersion: '1.7.0', name: 'Fixture' });
    expect(JSON.parse(f.read('package.json'))).toEqual({ version, private: true });
    expect(JSON.parse(f.read('versions.json'))).toEqual({ '1.2.3': '1.6.0', [version]: '1.7.0' });
    expect(f.calls().map(({ args }) => args)).toEqual([
      ['branch', '--show-current'], ['status', '--porcelain'], ['install', '--package-lock-only', '--ignore-scripts'],
      ['run', 'release:check'], ['add', 'manifest.json', 'package.json', 'package-lock.json', 'versions.json', 'styles.css',
        'THIRD_PARTY_NOTICES.md', '.local/generated', '.local/plugin/main.js', '.local/plugin/tern_engine_bg.wasm',
        '.local/plugin/embeddinggemma-worker.js', '.local/plugin/pdf-worker.js', '.local/plugin/pdf-ocr-worker.js',
        '.local/plugin/embeddinggemma-runtime.wasm', '.local/plugin/embeddinggemma-runtime.mjs'],
      ['commit', '-m', `chore(release): ${version}`],
    ]);
  });

  it.each(['--help', 'invalid'])('범프 인자 %s는 Git 전에 처리한다', (arg) => {
    const f = fixture('bump-version.mjs');
    expect(f.run([arg]).status).toBe(arg === '--help' ? 0 : 1);
    expect(f.calls()).toEqual([]);
  });

  it.each(['--package-lock-only', 'release:check'])('범프 검사 %s 실패 후에는 Git을 변경하지 않는다', (stage) => {
    const f = fixture('bump-version.mjs', stage);
    expect(f.run().status).toBe(7);
    expect(f.calls().at(-1).args[1]).toBe(stage);
    expect(f.calls().some(({ args }) => ['add', 'commit'].includes(args[0]))).toBe(false);
  });

  it('Git 실패 상태를 유지하고 이후 릴리스 변형을 생략한다', () => {
    const bump = fixture('bump-version.mjs', 'stage-fails');
    expect(bump.run().status).toBe(16);
    expect(bump.calls().at(-1).args[0]).toBe('add');
    const tag = fixture('tag-release.mjs', 'fetch-fails');
    expect(tag.run().status).toBe(18);
    expect(tag.calls().at(-1).args[0]).toBe('fetch');
  });

  it.each([['existing-tag', 1], ['denied', 19], ['post-tag-denied', 21], ['', 0]])('태그는 dev→main 정책 확인과 기존 태그 검사를 우회하지 않는다 (%s)', (mode, status) => {
    const f = fixture('tag-release.mjs', mode);
    const result = f.run();
    expect(result.status, result.stderr).toBe(status);
    const calls = f.calls().map(({ args }) => args);
    expect(calls.slice(0, 4)).toEqual([
      ['branch', '--show-current'], ['status', '--porcelain'], ['fetch', '--no-tags', 'origin', 'main', 'dev'], ['tag', '--list', '1.2.3'],
    ]);
    const followup = [
      ['scripts/check-branch-policy.mjs', '--release-tag', '1.2.3'], ['tag', '-a', '1.2.3', '-m', 'release: 1.2.3'],
      ['scripts/check-branch-policy.mjs', '--push-tag', '1.2.3'],
    ];
    expect(calls.slice(4)).toEqual(followup.slice(0, mode === 'existing-tag' ? 0 : mode === 'denied' ? 1 : 3));
  });

  it.each(['bump-version.mjs', 'tag-release.mjs'])('%s는 v 접두어 버전을 거부한다', (script) => {
    const f = fixture(script);
    f.json('manifest.json', { version: 'v1.2.3' });
    const result = f.run();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain('SemVer');
    expect(f.calls().map(({ args }) => args[0])).toEqual(script === 'tag-release.mjs' ? ['branch', 'status', 'fetch'] : ['branch', 'status']);
  });

  function setupFixture(mode = '') {
    const f = fixture('setup-dev.mjs', mode);
    const out = join(f.root, '.local/plugin');
    const vault = join(f.root, '.test-vault');
    const plugins = join(vault, '.obsidian/plugins');
    return { f, vault, plugins, build() {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'main.js'), 'synthetic output');
      writeFileSync(join(out, 'manifest.json'), '{}');
      writeFileSync(join(f.root, '.gitignore'), 'keep\n');
    } };
  }

  it('setup은 출력 경계를 확인한 후에만 연결을 생성하며 기존 연결을 보존한다', () => {
    const { f, vault, plugins, build } = setupFixture();
    expect(f.run().status).toBe(1);
    expect(existsSync(vault)).toBe(false);
    build();
    mkdirSync(plugins, { recursive: true });
    const link = join(plugins, 'superpower-inside');
    const other = join(f.root, 'caller');
    writeFileSync(join(other, 'main.js'), 'do not touch');
    symlinkSync(other, link, 'junction');
    const conflict = f.run();
    expect(conflict.status).toBe(1);
    expect(conflict.stderr).toContain('재설정');
    expect(readFileSync(join(link, 'main.js'), 'utf8')).toBe('do not touch');
    expect(f.calls()).toEqual([]);
  });

  it.each(['', 'clone-fails'])('setup은 연결, clone, ignore를 순서대로 처리한다 (%s)', (mode) => {
    const { f, plugins, build } = setupFixture(mode);
    build();
    const result = f.run();
    expect(result.status, result.stderr).toBe(mode ? 14 : 0);
    expect(readFileSync(join(plugins, 'superpower-inside/main.js'), 'utf8')).toBe('synthetic output');
    expect(f.calls().map(({ args }) => args)).toEqual([
      ['clone', '--depth', '1', 'https://github.com/pjeby/hot-reload.git', join(plugins, 'hot-reload')],
    ]);
    if (!mode) expect(f.run().status).toBe(0);
    expect(f.calls()).toHaveLength(1);
    expect(f.read('.gitignore').match(/^\.test-vault\/$/gm) ?? []).toHaveLength(mode ? 0 : 1);
  });

  it('macOS debug launcher는 앱·볼트 경로를 나누지 않고 open 종료 코드를 유지한다', () => {
    const f = fixture('launch-obsidian-debug.mjs');
    const app = join(f.root, '앱 & Obsidian.app');
    const vault = join(f.root, '.test-vault');
    const platform = ['--import', 'data:text/javascript,Object.defineProperty(process,"platform",{value:"darwin"})'];
    const env = { OBSIDIAN_APP: app };
    expect(f.run([], platform, env).status).toBe(1);
    mkdirSync(app);
    expect(f.run([], platform, env).status).toBe(1);
    expect(f.calls()).toEqual([]);
    mkdirSync(vault);
    expect(f.run([], platform, env).status).toBe(17);
    expect(f.calls().map(({ command, args }) => [command, ...args])).toEqual([
      ['open', '-a', app, '--args', '--remote-debugging-port=9222', vault],
    ]);
  });
  it.each(['win32', 'linux'])('%s는 네이티브 실행 파일에 볼트 경로를 한 인자로 넘긴다', (os) => {
    const f = fixture('launch-obsidian-debug.mjs');
    const app = join(f.root, '앱 & Obsidian.exe');
    const vault = join(f.root, '.test-vault');
    const platform = ['--import', `data:text/javascript,Object.defineProperty(process,"platform",{value:"${os}"})`];
    mkdirSync(vault);
    writeFileSync(app, 'synthetic executable');
    const result = f.run([], platform, { OBSIDIAN_EXE: app });
    expect(result.status, result.stderr).toBe(17);
    expect(f.calls().map(({ command, args }) => [command, ...args])).toEqual([
      [app, ...(os === 'win32' ? [`--user-data-dir=${join(vault, '.obsidian-dev-profile')}`] : []), '--remote-debugging-port=9222', vault],
    ]);
  });
  it('커밋·푸시 훅은 오프라인 검사만 하고 Patina 온라인을 자동 실행하지 않는다', () => {
    expect(read('.githooks/pre-commit')).toContain('pre-commit.mjs');
    expect(read('.githooks/pre-push')).toContain('pre-push.mjs');
    expect(read('scripts/pre-commit.mjs')).toContain('--staged');
    expect(read('scripts/pre-commit.mjs')).not.toContain('copy:check');
    expect(read('scripts/pre-push.mjs')).toContain('check-quality.mjs');
    expect(read('scripts/pre-push.mjs')).not.toContain('--online');
    const release = read('.github/workflows/release.yml');
    expect(release).not.toContain('pull_request:');
    expect(release).toContain("- '[0-9]*.[0-9]*.[0-9]*'");
    expect(release).toContain('draft: true');
    expect(release).toContain('check-branch-policy.mjs');
    expect(release).not.toContain('check-copy.mjs');
    expect(existsSync(new URL('../.github/workflows/copy.yml', import.meta.url))).toBe(false);
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['quality:local']).toContain('scripts/check-quality.mjs');
    expect(scripts['quality:local']).not.toMatch(/copy:|perf-gate|rust:security/);
    expect(scripts['release:check']).toContain('scripts/check-release.mjs');
    expect(read('scripts/check-release.mjs')).toContain('security:full');
    expect(read('scripts/check-release.mjs')).not.toContain('copy:check');
    expect(scripts['copy:check']).toBe('node scripts/check-copy.mjs --offline');
    expect(scripts['copy:check:online']).toBe('node scripts/check-copy.mjs --online');
  });
  it('릴리스 CI는 범위 검사와 전체 검사를 구분한다', () => {
    expect(read('.github/workflows/release.yml')).not.toContain(
      'Verify manifest version matches tag',
    );
    expect(read('.github/workflows/quality.yml')).toContain('quality:local');
    expect(read('.github/workflows/quality.yml')).toContain('security:full');
  });
});
