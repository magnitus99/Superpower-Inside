import { describe, expect, it } from 'vitest';
import {
  isCopyPath,
  languageText,
  validateScore,
  validateRewrite,
  scoreArgs,
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
import { join, resolve, delimiter } from 'node:path';

describe('홍보 문구 검사 계약', () => {
  it('온라인 검사에는 Codex 모델을 명시하고 오프라인 옵션을 제거한다', () => {
    expect(scoreArgs('en', true)).toContain('codex-cli');
    expect(scoreArgs('en', true)).toContain('gpt-6.1-sol');
    expect(scoreArgs('en', true)).not.toContain('--offline');
    expect(scoreArgs('ko', false)).toContain('--offline');
    expect(scoreArgs('ko')).toContain('15');
  });
  it('한영 README와 홍보 문서를 포함하고 에이전트 규칙은 제외한다', () => {
    for (const file of [
      'README.md',
      'marketing/launch.md',
      'copy/homepage.md',
      'releases/2.3.0.md',
      'manifest.json',
      'package.json',
    ])
      expect(isCopyPath(file)).toBe(true);
    for (const file of [
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

describe('릴리스 문구 검사와 오프라인 Git 타임라인', () => {
  function fixture(action) {
    const cwd = mkdtempSync(join(tmpdir(), 'copy-gate-'));
    const log = join(cwd, 'calls.jsonl');
    const npm = join(cwd, 'npm');
    writeFileSync(
      npm,
      `#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
let text = '';
if (args[0] === 'exec') text = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.COPY_LOG, JSON.stringify({args, text}) + '\\n');
if (args[0] === 'view') {
  if (process.env.COPY_REGISTRY_FAIL) process.exit(1);
  const version = JSON.stringify(process.env.COPY_VERSION || '99.0.0');
  console.log(process.env.COPY_BARE_VERSION ? version : '[' + version + ']');
} else if (args.includes('--verify')) {
  const output = text.replaceAll('BAD', 'Safe');
  console.log(JSON.stringify({output, verification: {verified: true, mps: 100, fidelity: 100, outputHash: crypto.createHash('sha256').update(output).digest('hex')}}));
} else {
  const failed = text.includes('BAD');
  console.log(JSON.stringify({mode: 'score', overall: failed ? 80 : 0, gateResult: {threshold: 15, passed: !failed, exitCode: failed ? 3 : 0}, scores: !args.includes('--offline') && !process.env.COPY_NO_LLM ? {llm: {overall: failed ? 80 : 0}} : {llm: null}}));
  process.exitCode = failed ? 3 : 0;
}
`,
    );
    chmodSync(npm, 0o755);
    const codex = join(cwd, 'codex');
    writeFileSync(codex, '#!/usr/bin/env node\nprocess.exit(1);\n');
    chmodSync(codex, 0o755);
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
          PATH: `${cwd}${delimiter}${process.env.PATH}`,
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

  it('삭제한 스테이징 검사 모드는 온라인 호출이나 파일 수정 없이 거부한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD staged copy');
      git('add', 'README.md');
      writeFileSync(join(cwd, 'README.md'), 'Unstaged copy');
      const result = run(['--staged']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('알 수 없는 실행 모드: --staged');
      expect(calls()).toEqual([]);
      expect(git('show', ':README.md')).toBe('BAD staged copy');
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Unstaged copy');
    }));

  it('커밋은 레지스트리·모델 호출과 파일 재작성 없이 스테이징 형식만 검사한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD copy');
      git('add', 'README.md');
      expect(run(['--commit-local'], { COPY_REGISTRY_FAIL: '1' }).status).toBe(0);
      expect(calls()).toEqual([]);
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('BAD copy');
      writeFileSync(join(cwd, 'README.md'), 'space \n');
      git('add', 'README.md');
      expect(run(['--commit-local']).status).toBe(1);
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ description: '' }));
      git('add', 'package.json');
      expect(run(['--commit-local']).status).toBe(1);
    }));

  it('일반 브랜치·비릴리스 태그·삭제는 과거 문구와 무관하게 모델을 호출하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD copy');
      git('add', '.');
      git('commit', '-qm', 'fixture');
      const sha = git('rev-parse', 'HEAD'),
        zero = '0'.repeat(40);
      expect(
        run(
          ['--push'],
          { COPY_REGISTRY_FAIL: '1' },
          `refs/heads/main ${sha} refs/heads/main ${zero}\nrefs/tags/dev ${sha} refs/tags/dev ${zero}\nrefs/tags/1.0.0 ${zero} refs/tags/1.0.0 ${sha}\n`,
        ).status,
      ).toBe(0);
      expect(calls()).toEqual([]);
    }));

  it('주석 릴리스 태그의 최종 전체 문구를 검사하며 중간 이력과 작업 파일은 제외한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD intermediate');
      writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({ version: '2026.10.14', description: 'Safe description' }),
      );
      writeFileSync(
        join(cwd, 'manifest.json'),
        JSON.stringify({ version: '2026.10.14', description: 'Safe description' }),
      );
      git('add', '.');
      git('commit', '-qm', 'intermediate');
      writeFileSync(join(cwd, 'README.md'), 'Final release copy');
      git('add', '.');
      git('commit', '-qm', 'final');
      git('tag', '-a', '2026.10.14', '-m', 'release');
      const tag = git('rev-parse', '2026.10.14');
      writeFileSync(join(cwd, 'README.md'), 'BAD unstaged');
      expect(
        run(['--push'], {}, `refs/tags/2026.10.14 ${tag} refs/tags/2026.10.14 ${'0'.repeat(40)}\n`).status,
      ).toBe(0);
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .map((call) => call.text),
      ).toEqual([
        'Final release copy',
        'Final release copy',
        'Safe description',
        'Safe description',
      ]);
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('BAD unstaged');
    }));

  it('릴리스 태그와 버전이 다르면 온라인 호출 전에 차단한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(
        join(cwd, 'manifest.json'),
        JSON.stringify({ version: '2026.10.15', description: 'Safe' }),
      );
      writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({ version: '2026.10.15', description: 'Safe' }),
      );
      git('add', '.');
      git('commit', '-qm', 'version');
      expect(
        run(
          ['--push'],
          {},
          `refs/tags/2026.10.14 ${git('rev-parse', 'HEAD')} refs/tags/2026.10.14 ${'0'.repeat(40)}\n`,
        ).status,
      ).toBe(1);
      expect(calls()).toEqual([]);
    }));

  it('릴리스 전에 통과한 동일 문구는 태그 푸시에서 다시 모델을 호출하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe release');
      writeFileSync(
        join(cwd, 'manifest.json'),
        JSON.stringify({ version: '2026.10.14', description: 'Safe' }),
      );
      writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({ version: '2026.10.14', description: 'Safe' }),
      );
      expect(run([]).status).toBe(0);
      git('add', '.');
      git('commit', '-qm', 'release');
      const sha = git('rev-parse', 'HEAD');
      expect(
        run(['--push'], {}, `refs/tags/2026.10.14 ${sha} refs/tags/2026.10.14 ${'0'.repeat(40)}\n`).status,
      ).toBe(0);
      expect(calls().filter((call) => call.args.includes('--score'))).toHaveLength(4);
      expect(calls().filter((call) => call.args[0] === 'view')).toHaveLength(2);
      expect(run(['--refresh']).status).toBe(0);
      expect(calls().filter((call) => call.args.includes('--score'))).toHaveLength(8);
    }));

  it('문구·최신 버전·정책 변경은 통과 기록을 무효화한다', () =>
    fixture(({ cwd, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe');
      expect(run([]).status).toBe(0);
      writeFileSync(join(cwd, 'README.md'), 'Changed');
      expect(run([]).status).toBe(0);
      expect(run([], { COPY_VERSION: '99.0.1' }).status).toBe(0);
      expect(run([], { COPY_VERSION: '99.0.1', COPY_BARE_VERSION: '1' }).status).toBe(0);
      writeFileSync(join(cwd, '.patina.yaml'), 'star-nudge: false\n');
      expect(run([], { COPY_VERSION: '99.0.1' }).status).toBe(0);
      expect(calls().filter((call) => call.args.includes('--score'))).toHaveLength(8);
    }));

  it('캐시가 있어도 최신 버전 조회 실패는 차단하고 오프라인 결과는 재사용하지 않는다', () =>
    fixture(({ cwd, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe');
      expect(run(['--offline']).status).toBe(0);
      expect(run([]).status).toBe(0);
      expect(run([], { COPY_REGISTRY_FAIL: '1' }).status).toBe(1);
      expect(calls().filter((call) => call.args.includes('--score'))).toHaveLength(4);
    }));

  it('손상·만료·실제 모델 점수가 없는 기록은 다시 채점한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe');
      expect(run([]).status).toBe(0);
      const receipt = join(cwd, git('rev-parse', '--git-path', 'patina-release.json'));
      writeFileSync(receipt, '{broken');
      expect(run([]).status).toBe(0);
      const entry = JSON.parse(readFileSync(receipt, 'utf8'));
      entry.checkedAt = 0;
      writeFileSync(receipt, JSON.stringify(entry));
      expect(run([]).status).toBe(0);
      const missing = JSON.parse(readFileSync(receipt, 'utf8'));
      missing.scores[0].scores.llm = null;
      writeFileSync(receipt, JSON.stringify(missing));
      expect(run([]).status).toBe(0);
      expect(calls().filter((call) => call.args.includes('--score'))).toHaveLength(8);
    }));

  it('실모델 점수 누락과 기준 초과는 차단하며 검사만으로 재작성하지 않는다', () =>
    fixture(({ cwd, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe');
      expect(run([], { COPY_NO_LLM: '1' }).status).toBe(1);
      writeFileSync(join(cwd, 'README.md'), 'BAD copy');
      expect(run([]).status).toBe(1);
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('BAD copy');
      expect(calls().some((call) => call.args.includes('--verify'))).toBe(false);
    }));

  it('명시적 재작성만 의미 보존·양언어 재검사 후 저장하고 인덱스는 보존한다', () =>
    fixture(({ cwd, git, run }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD copy');
      git('add', 'README.md');
      expect(run(['--fix', 'README.md', 'en']).status).toBe(0);
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Safe copy');
      expect(git('show', ':README.md')).toBe('BAD copy');
    }));

  it('릴리스 CI는 지정한 커밋의 전체 문구를 명시적 오프라인 방식으로 검사한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      git('add', '.');
      git('commit', '-qm', 'release');
      expect(run(['--release-ref', git('rev-parse', 'HEAD'), '--offline']).status).toBe(0);
      const scores = calls().filter((call) => call.args.includes('--score'));
      expect(scores).toHaveLength(2);
      expect(scores.every((call) => call.args.includes('--offline'))).toBe(true);
    }));

  it('Codex wrapper가 사용자가 지정한 모델과 high 설정을 보존한다', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'copy-codex-'));
    try {
      const executable = join(cwd, 'capture');
      writeFileSync(
        executable,
        '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n',
      );
      chmodSync(executable, 0o755);
      const result = spawnSync(
        process.execPath,
        [resolve('scripts/patina-bin/codex'), 'exec', '--model', 'gpt-6.1-sol'],
        { encoding: 'utf8', env: { ...process.env, PATINA_CODEX_EXECUTABLE: executable } },
      );
      expect(JSON.parse(result.stdout)).toEqual([
        'exec',
        '-c',
        'model_reasoning_effort="high"',
        '--model',
        'gpt-6.1-sol',
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
