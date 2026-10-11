import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
describe('검사 시점과 중복 제거', () => {
  it('미커밋 파일이 여러 개 있어도 릴리스 버전 수정 전에 멈춘다', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-dirty-'));
    try {
      expect(spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root }).status).toBe(
        0,
      );
      writeFileSync(join(root, 'first.txt'), 'first');
      writeFileSync(join(root, 'second.txt'), 'second');
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./bump-version.mjs', import.meta.url))],
        { cwd: root, encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('릴리스 준비 전에 작업 변경을 검토하고 커밋하세요');
      expect(readFileSync(join(root, 'first.txt'), 'utf8')).toBe('first');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('커밋과 일반 CI에 Patina를 넣지 않고 릴리스 태그만 검사한다', () => {
    expect(read('.githooks/pre-commit')).toContain('--commit-local');
    const release = read('.github/workflows/release.yml');
    const copy = release.split('\n  copy:\n')[1].split('\n  publish:\n')[0];
    expect(release).not.toContain('pull_request:');
    expect(release).toContain("- '[0-9]+.[0-9]+.[0-9]+'");
    expect(release).toContain('needs: [quality, copy]');
    expect(copy).toContain('runs-on: ubuntu-latest');
    expect(copy).toContain('permissions:\n      contents: read');
    expect(copy).not.toContain('write');
    expect(copy).toContain('--release-ref "$GITHUB_SHA" --offline');
    expect(existsSync(new URL('../.github/workflows/copy.yml', import.meta.url))).toBe(false);
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['quality:local']).toContain('scripts/check-quality.mjs');
    expect(scripts['quality:local']).not.toMatch(/copy:|perf-gate|rust:security/);
    expect(scripts['release:check']).toContain('scripts/check-release.mjs');
    expect(read('scripts/check-release.mjs')).toContain('security:full');
    expect(read('scripts/check-release.mjs')).toContain('copy:check');
  });
  it('릴리스 스크립트는 전체 게이트를 재사용해 성능 검사를 빠뜨리지 않는다', () => {
    const script = read('scripts/bump-version.mjs');
    expect(script).toContain("['run', 'release:check']");
    expect(script).not.toContain('npx -y npm@10 ci');
    expect(script.indexOf("['status', '--porcelain']")).toBeLessThan(
      script.indexOf('const manifest = readJson'),
    );
    expect(script).toContain('embeddinggemma-worker.js');
    expect(read('.github/workflows/release.yml')).not.toContain(
      'Verify manifest version matches tag',
    );
    expect(read('.github/workflows/quality.yml')).toContain('quality:local');
    expect(read('.github/workflows/quality.yml')).toContain('security:full');
  });
});
