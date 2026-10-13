import { describe, expect, it } from 'vitest';
import { validateVerdict } from './check-philosophy.mjs';

describe('제품 철학 판정 계약', () => {
  it('근거 있는 세 영역의 통과만 승인한다', () => {
    const checks = ['copy', 'behavior', 'audience'].map((area) => ({
      area,
      passed: true,
      evidence: 'README.md:15 — 사용자의 출처 확인 작업을 설명한다.',
    }));
    expect(() => validateVerdict({ checks })).not.toThrow();
    expect(() => validateVerdict({ checks: checks.slice(1) })).toThrow();
    expect(() => validateVerdict({ checks: [...checks, checks[0]] })).toThrow();
    expect(() =>
      validateVerdict({ checks: checks.map((item) => ({ ...item, evidence: '' })) }),
    ).toThrow();
    expect(() =>
      validateVerdict({ checks: checks.map((item) => ({ ...item, passed: false })) }),
    ).toThrow();
  });
});

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('오프라인은 모델을 호출하지 않고 의미 검토 실패는 차단한다', () => {
  const root = mkdtempSync(join(tmpdir(), 'philosophy-contract-'));
  try {
    expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0);
    spawnSync('git', ['config', 'user.name', '검증'], { cwd: root });
    spawnSync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
    writeFileSync(
      join(root, 'product-philosophy.md'),
      '## 문구:\n## 버튼:\n## README:\n## 사용자와 가치\n## 판단 기준과 경계',
    );
    for (const file of ['manifest.json', 'package.json']) writeFileSync(join(root, file), '{}');
    writeFileSync(join(root, 'README.md'), '합성 제품 안내');
    spawnSync('git', ['add', '.'], { cwd: root });
    expect(
      spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'], {
        cwd: root,
      }).status,
    ).toBe(0);
    mkdirSync(join(root, 'bin'));
    const log = join(root, 'called');
    const codex = join(root, 'bin', 'codex');
    writeFileSync(
      codex,
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.TEST_LOG, JSON.stringify(process.argv));
fs.writeFileSync(process.env.TEST_LOG + '.input', fs.readFileSync(0, 'utf8'));
const out = process.argv[process.argv.indexOf('--output-last-message') + 1];
fs.writeFileSync(out, JSON.stringify({checks:['copy','behavior','audience'].map(area=>({area,passed:process.env.TEST_FAIL !== 'true',evidence:'README.md:1 합성 근거'}))}));
`,
    );
    chmodSync(codex, 0o755);
    const run = (args, fail = '') =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./check-philosophy.mjs', import.meta.url)), ...args],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`,
            TEST_LOG: log,
            TEST_FAIL: fail,
          },
        },
      );
    expect(run(['--offline']).status).toBe(0);
    expect(() => readFileSync(log)).toThrow();
    expect(run(['--full']).status).toBe(0);
    const argv = JSON.parse(readFileSync(log, 'utf8'));
    expect(argv).not.toContain('--model');
    expect(argv).toContain('read-only');
    expect(() => readFileSync(argv[argv.indexOf('--output-last-message') + 1])).toThrow();
    expect(run(['--full'], 'true').status).toBe(1);
    expect(run(['--ref', 'HEAD']).status).toBe(0);
    const prompt = readFileSync(log + '.input', 'utf8');
    const data = JSON.parse(prompt.split('검토 자료:\n')[1]);
    expect(data.scope).toContain('README.md');
    expect(data.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(run(['--ref', 'missing-ref', '--offline']).status).toBe(1);
    writeFileSync(join(root, 'product-philosophy.md'), '변경된 불완전 문서');
    expect(run(['--offline']).status).toBe(1);
    expect(run(['--ref', 'HEAD', '--offline']).status).toBe(1);
    rmSync(join(root, 'product-philosophy.md'));
    expect(run(['--offline']).stdout).toContain('검사를 생략');
    expect(run(['--full']).status).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
