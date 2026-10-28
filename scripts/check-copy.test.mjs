import { describe, expect, it } from 'vitest';
import {
  isCopyPath,
  languageText,
  onlineSettings,
  scoreArgs,
  validateRewrite,
  validateScore,
} from './check-copy.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

describe('홍보 문구 검사 계약', () => {
  it('기본은 오프라인이고 온라인은 명시적 백엔드·모델 입력을 요구한다', () => {
    expect(scoreArgs('en')).toContain('--offline');
    expect(scoreArgs('en', false)).toContain('--offline');
    expect(scoreArgs('en', true)).toContain('claude-cli');
    expect(scoreArgs('en', true)).not.toContain('--offline');
    expect(scoreArgs('ko', true)).toContain('15');
    expect(onlineSettings({ PATINA_PI_MODEL: 'provider/model', PATINA_PI_THINKING: 'high' })).toEqual(
      { model: 'provider/model', thinking: 'high' },
    );
    expect(() => onlineSettings({ PATINA_PI_MODEL: 'provider/model' })).toThrow(
      /PATINA_PI_THINKING/,
    );
    expect(() => onlineSettings({ PATINA_PI_THINKING: 'high' })).toThrow(/PATINA_PI_MODEL/);
  });
  it('README만 검사하고 다른 문서는 제외한다', () => {
    expect(isCopyPath('README.md')).toBe(true);
    for (const file of [
      'marketing/launch.md',
      'copy/homepage.md',
      'manifest.json',
      'package.json',
    ])
      expect(isCopyPath(file)).toBe(false);
    for (const file of [
      'releases/2.3.0.md',
      'releases/3.3.0.mdx',
      'AGENTS.md',
      'docs/AGENTS.md',
      'src/chat/AGENTS.md',
      'design.md',
      'docs/architecture.md',
      'docs/guide.md',
      'docs/README_KO.md',
      'crates/README.md',
      'public/robots.txt',
      'THIRD_PARTY_NOTICES.md',
      'tests/fixtures/sample.md',
      'package-lock.json',
    ])
      expect(isCopyPath(file)).toBe(false);
  });
  it('README 언어 구간을 분리해 다른 언어로 점수가 희석되지 않는다', () => {
    const text = '# Product\nEnglish copy\n## 한국어\n한국어 문구';
    expect(languageText(text, 'en')).toBe('# Product\nEnglish copy\n');
    expect(languageText(text, 'ko')).toBe('## 한국어\n한국어 문구');
  });
  it('15점은 통과하고 초과 점수 및 잘못된 응답은 실패한다', () => {
    const envelope = {
      mode: 'score',
      overall: 15,
      gateResult: { threshold: 15, passed: true, exitCode: 0 },
    };
    expect(validateScore(envelope, 0, 15)).toBe(15);
    expect(() => validateScore({ ...envelope, overall: 16 }, 0, 15)).toThrow();
    expect(() => validateScore({ ...envelope, overall: null }, 0, 15)).toThrow();
    expect(() => validateScore(envelope, 3, 15)).toThrow();
  });
  it('검증된 정확한 출력과 의미 보존 점수만 허용한다', () => {
    const output = '원래 의미를 유지한 문구';
    const envelope = {
      output,
      verification: {
        verified: true,
        mps: 95,
        fidelity: 95,
        outputHash: createHash('sha256').update(output).digest('hex'),
      },
    };
    expect(validateRewrite(envelope, 0)).toBe(output);
    expect(() => validateRewrite(envelope, 4)).toThrow();
    expect(() => validateRewrite({ ...envelope, output: '변경된 문구' }, 0)).toThrow();
    expect(() =>
      validateRewrite({ ...envelope, verification: { ...envelope.verification, mps: 70 } }, 0),
    ).toThrow();
  });
});

describe('Patina 실행 정책', () => {
  function fixture(action) {
    const cwd = mkdtempSync(join(tmpdir(), 'patina-policy-'));
    const bin = join(cwd, 'bin');
    const log = join(cwd, 'calls.jsonl');
    writeFileSync(join(cwd, 'README.md'), 'Safe copy\n');
    mkdirSync(bin, { recursive: true });
    const patina = join(bin, 'patina');
    writeFileSync(
      patina,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const text = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.COPY_LOG, JSON.stringify({ tool: 'patina', args, text }) + '\\n');
const failed = text.includes('BAD');
console.log(JSON.stringify({ mode: 'score', overall: failed ? 80 : 0, gateResult: { threshold: 15, passed: !failed, exitCode: failed ? 3 : 0 }, scores: { llm: null } }));
process.exitCode = failed ? 3 : 0;
`,
    );
    chmodSync(patina, 0o755);
    const npm = join(bin, 'npm');
    writeFileSync(
      npm,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'view') {
  fs.appendFileSync(process.env.COPY_LOG, JSON.stringify({ tool: 'npm', args }) + '\\n');
  console.log(JSON.stringify(process.env.COPY_VERSION || '99.0.0'));
  process.exit(0);
}
const text = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.COPY_LOG, JSON.stringify({ tool: 'npm', args, text, model: process.env.PATINA_PI_MODEL, thinking: process.env.PATINA_PI_THINKING }) + '\\n');
const failed = text.includes('BAD');
console.log(JSON.stringify({ mode: 'score', overall: failed ? 80 : 0, gateResult: { threshold: 15, passed: !failed, exitCode: failed ? 3 : 0 }, scores: { llm: { overall: failed ? 80 : 0 } } }));
process.exitCode = failed ? 3 : 0;
`,
    );
    chmodSync(npm, 0o755);
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    git('init', '-q');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', '검사 테스트');
    git('config', 'core.hooksPath', '/dev/null');
    const run = (args, extra = {}, input) =>
      spawnSync(process.execPath, [resolve('scripts/check-copy.mjs'), ...args], {
        cwd,
        encoding: 'utf8',
        input,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          COPY_LOG: log,
          ...extra,
        },
      });
    const calls = () =>
      !existsSync(log)
        ? []
        : readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
    try {
      action({ cwd, git, run, calls });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  it('기본 검사는 오프라인이며 레지스트리·모델을 호출하지 않는다', () =>
    fixture(({ run, calls }) => {
      expect(run([]).status).toBe(0);
      expect(calls().map((call) => call.tool)).toEqual(['patina', 'patina']);
      expect(calls().every((call) => call.args.includes('--offline'))).toBe(true);
    }));

  it('온라인 검사는 모델·추론 강도를 명시하지 않으면 실행 전에 막는다', () =>
    fixture(({ run, calls }) => {
      const result = run(['--online'], {
        PATINA_PI_MODEL: '',
        PATINA_PI_THINKING: '',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('PATINA_PI_MODEL');
      expect(calls()).toEqual([]);
    }));

  it('온라인 검사는 명시적 플래그와 입력된 모델로만 실행한다', () =>
    fixture(({ run, calls }) => {
      const result = run(['--online'], {
        PATINA_PI_MODEL: 'provider/model',
        PATINA_PI_THINKING: 'high',
      });
      expect(result.status).toBe(0);
      expect(calls()[0]).toMatchObject({ tool: 'npm' });
      expect(calls()[0].args.slice(0, 2)).toEqual(['view', 'patina-cli@latest']);
      const executions = calls().filter((call) => call.tool === 'npm' && call.args[0] === 'exec');
      expect(executions).toHaveLength(2);
      expect(
        executions.every(
          (call) => call.model === 'provider/model' && call.thinking === 'high',
        ),
      ).toBe(true);
    }));

  it('릴리스 참조 오프라인 검사는 커밋 문구만 읽고 모델을 호출하지 않는다', () =>
    fixture(({ git, run, calls }) => {
      writeFileSync(join(git('rev-parse', '--show-toplevel'), 'README.md'), 'Safe release copy\n');
      git('add', '.');
      git('commit', '-qm', 'fixture');
      const result = run(['--release-ref', 'HEAD']);
      expect(result.status).toBe(0);
      expect(calls().map((call) => call.tool)).toEqual(['patina', 'patina']);
      expect(calls()[0].text).toContain('Safe release copy');
    }));

  it('오프라인과 온라인을 동시에 지정하거나 알 수 없는 모드를 쓰면 거부한다', () =>
    fixture(({ run, calls }) => {
      expect(run(['--online', '--offline']).status).toBe(1);
      expect(run(['--push']).status).toBe(1);
      expect(calls()).toEqual([]);
    }));
});
