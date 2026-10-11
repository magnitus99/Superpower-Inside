import { describe, expect, it } from 'vitest';
import { qualityPlan, metadataOnly } from './check-quality.mjs';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

describe('변경 범위에 따른 검사 선택', () => {
  it.each(['docs', 'history', 'typescript', 'failure'])(
    '실제 Git 변경 범위에서 검사와 중단을 검증한다: %s',
    (scenario) => {
      const root = mkdtempSync(join(tmpdir(), 'quality-scope-'));
      try {
        const git = (...args) => {
          const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
          if (result.status !== 0) throw new Error(result.stderr);
          return result.stdout.trim();
        };
        git('init', '-q');
        git('config', 'user.name', '검사 범위');
        git('config', 'user.email', 'fixture@example.test');
        git('config', 'core.hooksPath', '/dev/null');
        mkdirSync(join(root, 'bin'));
        mkdirSync(join(root, 'src'));
        const npm = join(root, 'bin', 'npm');
        writeFileSync(
          npm,
          `#!/usr/bin/env node
const fs=require('node:fs');
const stage=process.argv[3];
fs.appendFileSync(process.env.QUALITY_LOG,stage+'\\n');
process.exitCode=stage===process.env.QUALITY_FAIL ? 1 : 0;
`,
        );
        chmodSync(npm, 0o755);
        writeFileSync(join(root, 'README.md'), 'before\n');
        writeFileSync(join(root, 'src', 'file.ts'), 'export const value = 1;\n');
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({
            version: '1.0.0',
            description: 'before',
            scripts: { test: 'unchanged' },
          }),
        );
        git('add', '.');
        git('commit', '-qm', 'fixture');
        const base = git('rev-parse', 'HEAD');
        const log = join(root, 'calls');
        const run = (args = [], failed = '') => {
          rmSync(log, { force: true });
          const result = spawnSync(
            process.execPath,
            [fileURLToPath(new URL('./check-quality.mjs', import.meta.url)), ...args],
            {
              cwd: root,
              encoding: 'utf8',
              env: {
                ...Object.fromEntries(
                  Object.entries(process.env).filter(
                    ([key]) => key.toLowerCase() !== 'npm_execpath',
                  ),
                ),
                PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`,
                npm_execpath: npm,
                QUALITY_LOG: log,
                QUALITY_FAIL: failed,
              },
            },
          );
          expect(result.status, result.stderr).toBe(failed ? 1 : 0);
          return { result, calls: readFileSync(log, 'utf8').trim().split('\n') };
        };
        writeFileSync(join(root, 'README.md'), 'after\n');
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({
            version: '1.0.1',
            description: 'after',
            scripts: { test: 'unchanged' },
          }),
        );
        if (scenario === 'docs') expect(run().calls).toEqual(['review']);
        else if (scenario === 'history') {
          git('add', 'README.md', 'package.json');
          git('commit', '-qm', 'docs');
          expect(run(['--base', base]).calls).toEqual(['review']);
        } else {
          writeFileSync(join(root, 'src', 'file.ts'), 'export const value = 2;\n');
          if (scenario === 'typescript')
            expect(run().calls).toEqual(['lint', 'typecheck', 'test', 'review']);
          else {
            const failed = run([], 'test');
            expect(failed.result.status).toBe(1);
            expect(failed.calls).toEqual(['lint', 'typecheck', 'test']);
          }
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
  it('문서·홍보·버전만 바꾸면 코드와 Rust 검사를 실행하지 않는다', () => {
    const plan = qualityPlan([
      'README.md',
      'AGENTS.md',
      'docs/spec.md',
      'src/chat/AGENTS.md',
      'marketing/intro.md',
      'manifest.json',
      'versions.json',
    ]);
    expect(plan.tests).toBe(false);
    expect(plan.typescript).toBe(false);
    expect(plan.rust).toBe(false);
    expect(plan.review).toBe(true);
    expect(qualityPlan([]).review).toBe(false);
  });
  it('TS 수정은 TS 검사를 선택하고 변경 없는 Rust 검사는 제외한다', () => {
    expect(qualityPlan(['src/settings.ts'])).toMatchObject({
      typescript: true,
      tests: true,
      rust: false,
      security: false,
    });
    expect(qualityPlan(['scripts/check-copy.mjs'])).toMatchObject({
      typescript: false,
      tests: true,
      rust: false,
    });
    expect(qualityPlan(['styles.css'])).toMatchObject({
      typescript: false,
      tests: true,
      rust: false,
    });
  });
  it('Rust와 공용 빌드 경계는 Rust 검사와 TS 계약 검사를 함께 선택한다', () => {
    expect(qualityPlan(['crates/rag-wasm/src/lib.rs'])).toMatchObject({
      typescript: true,
      tests: true,
      rust: true,
    });
    expect(qualityPlan(['scripts/build-rag-wasm.fish'])).toMatchObject({ tests: true, rust: true });
    expect(qualityPlan(['scripts/build-rag-wasm.mjs'])).toMatchObject({ tests: true, rust: true });
    expect(qualityPlan(['scripts/rust-process.mjs'])).toMatchObject({ tests: true, rust: true });
  });
  it('의존성·보안 정책 변경은 CI 전체 보안 검사 대상으로 선택한다', () => {
    expect(qualityPlan(['Cargo.lock']).security).toBe(true);
    expect(qualityPlan(['package-lock.json']).security).toBe(true);
    expect(qualityPlan(['deny.toml']).security).toBe(true);
    expect(qualityPlan(['.github/workflows/quality.yml']).workflows).toBe(true);
  });
  it('package와 lockfile의 버전·설명 변경은 의존성 변경과 구분한다', () => {
    const before = JSON.stringify({
      version: '1.0.0',
      description: 'old',
      dependencies: { a: '1' },
    });
    expect(
      metadataOnly(
        'package.json',
        before,
        JSON.stringify({ version: '1.0.1', description: 'new', dependencies: { a: '1' } }),
      ),
    ).toBe(true);
    expect(
      metadataOnly(
        'package.json',
        before,
        JSON.stringify({ version: '1.0.1', dependencies: { a: '2' } }),
      ),
    ).toBe(false);
    expect(metadataOnly('package.json', 'broken', before)).toBe(false);
    const lock = JSON.stringify({
      version: '1.0.0',
      packages: { '': { version: '1.0.0' }, 'node_modules/a': { version: '1' } },
    });
    expect(metadataOnly('package-lock.json', lock, lock.replaceAll('1.0.0', '1.0.1'))).toBe(true);
    expect(
      qualityPlan(
        ['package.json', 'package-lock.json'],
        new Set(['package.json', 'package-lock.json']),
      ),
    ).toMatchObject({ tests: false, security: false });
  });
});
