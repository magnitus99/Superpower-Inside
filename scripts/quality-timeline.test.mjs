import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { qualityPlan } from './check-quality.mjs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
describe('검사 시점과 중복 제거', () => {
  it('검색 품질 fixture 변경은 전체 테스트를 선택한다', () => {
    expect(
      qualityPlan(['src/rag/fixtures/embeddinggemma-cross-lingual.json']).tests,
    ).toBe(true);
  });

  it('미커밋 파일이 여러 개 있어도 릴리스 버전 수정 전에 멈춘다', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-dirty-'));
    try {
      expect(spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root }).status).toBe(
        0,
      );
      writeFileSync(join(root, 'first.txt'), 'first');
      writeFileSync(join(root, 'second.txt'), 'second');
      const result = spawnSync(
        'fish',
        ['--no-config', fileURLToPath(new URL('./bump-version.fish', import.meta.url))],
        { cwd: root, encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('릴리스 준비 전에 작업 변경을 검토하고 커밋하세요');
      expect(readFileSync(join(root, 'first.txt'), 'utf8')).toBe('first');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('릴리스 각 단계가 실패하면 다음 명령을 실행하지 않고 실패를 반환한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-gate-'));
    const order = ['security:full', 'build', 'review'];
    try {
      writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));
      const npm = join(root, 'npm');
      writeFileSync(
        npm,
        `#!/usr/bin/env node
const fs = require('node:fs');
const stage = process.argv[3];
fs.appendFileSync(process.env.RELEASE_LOG, stage + '\\n');
process.exitCode = stage === process.env.RELEASE_FAIL ? 7 : 0;
`,
      );
      chmodSync(npm, 0o755);
      for (const failed of [...order, '']) {
        const log = join(root, 'calls');
        rmSync(log, { force: true });
        const result = spawnSync(
          'fish',
          ['--no-config', fileURLToPath(new URL('./check-release.fish', import.meta.url))],
          {
            cwd: root,
            encoding: 'utf8',
            env: {
              ...process.env,
              PATH: `${root}${delimiter}${process.env.PATH}`,
              RELEASE_LOG: log,
              RELEASE_FAIL: failed,
            },
          },
        );
        expect(result.status, result.stderr).toBe(failed ? 7 : 0);
        expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(
          failed ? order.slice(0, order.indexOf(failed) + 1) : order,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('커밋과 일반 CI·릴리스 자동화에 Patina를 넣지 않고 수동 실행만 남긴다', () => {
    expect(read('.githooks/pre-commit')).toContain('--commit-local');
    const release = read('.github/workflows/release.yml');
    expect(release).not.toContain('pull_request:');
    expect(release).toContain("- '[0-9]*.[0-9]*.[0-9]*'");
    expect(release).toContain('draft: true');
    expect(release).toContain('needs: quality');
    expect(release).not.toContain('check-copy.mjs');
    expect(existsSync(new URL('../.github/workflows/copy.yml', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../.githooks/pre-push', import.meta.url))).toBe(false);
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['quality:local']).toContain('scripts/check-quality.mjs');
    expect(scripts['quality:local']).not.toMatch(/copy:|perf-gate|rust:security/);
    expect(scripts['release:check']).toContain('scripts/check-release.fish');
    expect(read('scripts/check-release.fish')).toContain('security:full');
    expect(read('scripts/check-release.fish')).not.toContain('copy:check');
    expect(scripts['copy:check']).toBe('node scripts/check-copy.mjs');
    expect(scripts['copy:check:online']).toBe('node scripts/check-copy.mjs --online');
  });
  it('릴리스 스크립트는 전체 게이트를 재사용해 성능 검사를 빠뜨리지 않는다', () => {
    const script = read('scripts/bump-version.fish');
    expect(script).toContain('npm run release:check');
    expect(script).not.toContain('npx -y npm@10 ci');
    expect(script.indexOf('git status --porcelain')).toBeLessThan(
      script.indexOf('set CURRENT_VERSION'),
    );
    expect(script).toContain('BUMP_TYPE');
    expect(script).toContain('embeddinggemma-worker.js');
    expect(read('.github/workflows/release.yml')).not.toContain(
      'Verify manifest version matches tag',
    );
    expect(read('.github/workflows/quality.yml')).toContain('quality:local');
    expect(read('.github/workflows/quality.yml')).toContain('security:full');
  });
});
