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

describe('훅 스냅샷과 최신 버전 강제 실행', () => {
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
  console.log(JSON.stringify('99.0.0'));
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

  it('최신 조회 실패 시 캐시 실행 없이 차단한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      git('add', 'README.md');
      expect(run(['--staged'], { COPY_REGISTRY_FAIL: '1' }).status).toBe(1);
      expect(calls().map((call) => call.args[0])).toEqual(['view']);
    }));

  it('코드만 스테이징하면 기존 README와 미스테이징 문구를 검사하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      git('add', 'README.md');
      git('commit', '-qm', '기존 제품 소개');
      writeFileSync(join(cwd, 'README.md'), 'BAD unstaged copy');
      writeFileSync(join(cwd, 'code.ts'), 'export const value = 1;');
      git('add', 'code.ts');
      expect(run(['--staged'], { COPY_REGISTRY_FAIL: '1' }).status).toBe(0);
      expect(calls()).toEqual([]);
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('BAD unstaged copy');
    }));

  it('개발 문서와 라이선스 수정은 문체 검사를 시작하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      mkdirSync(join(cwd, 'docs'));
      for (const file of [
        'AGENTS.md',
        'design.md',
        'docs/architecture.md',
        'THIRD_PARTY_NOTICES.md',
      ]) {
        writeFileSync(join(cwd, file), 'BAD technical fixture');
        git('add', file);
      }
      expect(run(['--staged'], { COPY_REGISTRY_FAIL: '1' }).status).toBe(0);
      expect(calls()).toEqual([]);
    }));

  it('제품 설명이 같으면 버전과 npm 스크립트 변경을 검사하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      const before = { description: 'Safe product copy', version: '1.0.0' };
      writeFileSync(join(cwd, 'package.json'), JSON.stringify(before));
      git('add', 'package.json');
      git('commit', '-qm', '기존 제품 설명');
      writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({ ...before, version: '2.0.0', scripts: { test: 'test' } }),
      );
      git('add', 'package.json');
      expect(run(['--staged'], { COPY_REGISTRY_FAIL: '1' }).status).toBe(0);
      expect(calls()).toEqual([]);
      writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({ ...before, description: 'New product copy' }),
      );
      git('add', 'package.json');
      expect(run(['--staged']).status).toBe(0);
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .map((call) => call.text),
      ).toEqual(['New product copy', 'New product copy']);
    }));

  it('변경된 제품 README만 스테이징 원문으로 검사한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      mkdirSync(join(cwd, 'marketing'));
      writeFileSync(join(cwd, 'README.md'), 'Original copy');
      writeFileSync(join(cwd, 'marketing/launch.md'), 'Unchanged copy');
      git('add', '.');
      git('commit', '-qm', '기존 홍보 문서');
      writeFileSync(join(cwd, 'README.md'), 'New staged copy');
      git('add', 'README.md');
      writeFileSync(join(cwd, 'README.md'), 'BAD unstaged copy');
      expect(run(['--staged']).status).toBe(0);
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .map((call) => call.text),
      ).toEqual(['New staged copy', 'New staged copy']);
    }));

  it('대상 문서 삭제만 있으면 최신 버전도 조회하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Original copy');
      git('add', 'README.md');
      git('commit', '-qm', '기존 제품 소개');
      git('rm', 'README.md');
      expect(run(['--staged'], { COPY_REGISTRY_FAIL: '1' }).status).toBe(0);
      expect(calls()).toEqual([]);
    }));

  it('코드 커밋만 푸시하면 기존 제품 소개를 다시 검사하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD existing copy');
      git('add', 'README.md');
      git('commit', '-qm', '기존 소개');
      const before = git('rev-parse', 'HEAD');
      writeFileSync(join(cwd, 'code.ts'), 'export const value = 1;');
      git('add', 'code.ts');
      git('commit', '-qm', '코드 변경');
      const sha = git('rev-parse', 'HEAD');
      expect(
        run(
          ['--push'],
          { COPY_REGISTRY_FAIL: '1' },
          `refs/heads/main ${sha} refs/heads/main ${before}\n`,
        ).status,
      ).toBe(0);
      expect(calls()).toEqual([]);
    }));

  it('새 브랜치가 기존 원격 커밋을 가리키면 이미 공개된 문서를 재검사하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD existing copy');
      git('add', 'README.md');
      git('commit', '-qm', '원격에 있던 소개');
      const sha = git('rev-parse', 'HEAD');
      git('update-ref', 'refs/remotes/origin/main', sha);
      expect(
        run(
          ['--push'],
          { COPY_REGISTRY_FAIL: '1' },
          `refs/heads/new ${sha} refs/heads/new ${'0'.repeat(40)}\n`,
        ).status,
      ).toBe(0);
      expect(calls()).toEqual([]);
    }));

  it('푸시 중간 커밋의 변경된 홍보 문구도 검사한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Original copy');
      git('add', 'README.md');
      git('commit', '-qm', '기존 소개');
      const before = git('rev-parse', 'HEAD');
      writeFileSync(join(cwd, 'README.md'), 'BAD changed copy');
      git('add', 'README.md');
      git('commit', '-qm', '홍보 변경');
      writeFileSync(join(cwd, 'code.ts'), 'export const value = 1;');
      git('add', 'code.ts');
      git('commit', '-qm', '후속 코드');
      writeFileSync(join(cwd, 'README.md'), 'Safe working copy');
      const sha = git('rev-parse', 'HEAD');
      expect(run(['--push'], {}, `refs/heads/main ${sha} refs/heads/main ${before}\n`).status).toBe(
        1,
      );
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .map((call) => call.text),
      ).toEqual(['BAD changed copy', 'BAD changed copy']);
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Safe working copy');
    }));

  it('CI 범위 검사도 문서 변경이 없으면 레지스트리를 호출하지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Original copy');
      git('add', 'README.md');
      git('commit', '-qm', '기존 소개');
      const before = git('rev-parse', 'HEAD');
      writeFileSync(join(cwd, 'code.ts'), 'export const value = 1;');
      git('add', 'code.ts');
      git('commit', '-qm', '코드 변경');
      expect(
        run(['--range', before, git('rev-parse', 'HEAD'), '--offline'], { COPY_REGISTRY_FAIL: '1' })
          .status,
      ).toBe(0);
      expect(calls()).toEqual([]);
    }));

  it('CI 범위에서 변경된 문구는 명시한 오프라인 방식으로 한영 검사한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Original copy');
      git('add', 'README.md');
      git('commit', '-qm', '기존 소개');
      const before = git('rev-parse', 'HEAD');
      writeFileSync(join(cwd, 'README.md'), 'Changed copy');
      git('add', 'README.md');
      git('commit', '-qm', '소개 변경');
      expect(run(['--range', before, git('rev-parse', 'HEAD'), '--offline']).status).toBe(0);
      const scores = calls().filter((call) => call.args.includes('--score'));
      expect(scores.map((call) => call.text)).toEqual(['Changed copy', 'Changed copy']);
      expect(scores.every((call) => call.args.includes('--offline'))).toBe(true);
    }));

  it('브랜치와 주석 태그의 같은 문구는 중복 검사하지 않고 삭제 참조는 건너뛴다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      git('add', 'README.md');
      git('commit', '-qm', '소개 추가');
      const sha = git('rev-parse', 'HEAD');
      git('tag', '-a', 'release', '-m', '릴리스');
      const tag = git('rev-parse', 'release');
      const zero = '0'.repeat(40);
      expect(
        run(
          ['--push'],
          {},
          `refs/heads/main ${sha} refs/heads/main ${zero}\nrefs/tags/release ${tag} refs/tags/release ${zero}\nrefs/heads/old ${zero} refs/heads/old ${sha}\n`,
        ).status,
      ).toBe(0);
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .map((call) => call.text),
      ).toEqual(['Safe copy', 'Safe copy']);
    }));

  it('새 브랜치를 다른 원격에 처음 보내면 그 원격에 없는 문구를 검사한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      git('add', 'README.md');
      git('commit', '-qm', '소개 추가');
      const sha = git('rev-parse', 'HEAD');
      git('update-ref', 'refs/remotes/origin/main', sha);
      expect(
        run(['--push', 'backup'], {}, `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`)
          .status,
      ).toBe(0);
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .map((call) => call.text),
      ).toEqual(['Safe copy', 'Safe copy']);
    }));

  it('병합 커밋에서 새로 작성한 소개 문구도 검사한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Original copy');
      git('add', 'README.md');
      git('commit', '-qm', '기존 소개');
      const before = git('rev-parse', 'HEAD');
      git('checkout', '-qb', 'side');
      writeFileSync(join(cwd, 'side.ts'), 'export const side = 1;');
      git('add', 'side.ts');
      git('commit', '-qm', '분기 코드');
      git('checkout', '-qb', 'target', before);
      writeFileSync(join(cwd, 'code.ts'), 'export const value = 1;');
      git('add', 'code.ts');
      git('commit', '-qm', '주 코드');
      git('merge', '--no-ff', '--no-commit', 'side');
      writeFileSync(join(cwd, 'README.md'), 'Merged copy');
      git('add', 'README.md');
      git('commit', '-qm', '병합 소개');
      const sha = git('rev-parse', 'HEAD');
      expect(run(['--push'], {}, `refs/heads/main ${sha} refs/heads/main ${before}\n`).status).toBe(
        0,
      );
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .map((call) => call.text),
      ).toEqual(['Merged copy', 'Merged copy']);
    }));

  it('수동 검사는 변경 여부와 관계없이 등록된 전체 문구를 검사한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      git('add', 'README.md');
      git('commit', '-qm', '기존 소개');
      expect(run([]).status).toBe(0);
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .map((call) => call.text),
      ).toEqual(['Safe copy', 'Safe copy']);
    }));

  it('온라인 모델 점수가 없으면 오프라인 점수로 통과시키지 않는다', () =>
    fixture(({ cwd, run }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      expect(run(['--online'], { COPY_NO_LLM: '1' }).status).toBe(1);
      expect(run(['--online']).status).toBe(0);
    }));

  it('커밋 훅의 스테이징 검사는 온라인 모델 응답을 필수로 요구한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      git('add', 'README.md');
      expect(run(['--staged'], { COPY_NO_LLM: '1' }).status).toBe(1);
      expect(run(['--staged']).status).toBe(0);
      const scores = calls().filter((call) => call.args.includes('--score'));
      expect(
        scores.every(
          (call) =>
            !call.args.includes('--offline') &&
            call.args.includes('codex-cli') &&
            call.args.includes('gpt-6.1-sol'),
        ),
      ).toBe(true);
    }));

  it('스테이징 내용이 실패하면 수정된 작업 파일로 통과시키지 않는다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD copy');
      git('add', 'README.md');
      writeFileSync(join(cwd, 'README.md'), 'Safe copy');
      expect(run(['--staged']).status).toBe(1);
      expect(git('show', ':README.md')).toBe('BAD copy');
      const scored = calls().filter((call) => call.args.includes('--score'));
      expect(scored.map((call) => call.args[call.args.indexOf('--lang') + 1])).toEqual([
        'en',
        'ko',
      ]);
      expect(
        scored.every(
          (call) => call.text === 'BAD copy' && call.args.includes('--package=patina-cli@99.0.0'),
        ),
      ).toBe(true);
      expect(calls().some((call) => call.args.includes('--verify'))).toBe(false);
    }));

  it('일치하는 작업 파일만 자동 재작성하고 인덱스와 커밋은 보존한다', () =>
    fixture(({ cwd, git, run, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD copy');
      git('add', 'README.md');
      expect(run(['--staged']).status).toBe(1);
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Safe copy');
      expect(git('show', ':README.md')).toBe('BAD copy');
      const rewrites = calls().filter((call) => call.args.includes('--verify'));
      expect(rewrites.length).toBe(2);
      expect(
        rewrites.every(
          (call) => call.args.includes('gpt-6.1-sol') && call.args.includes('codex-cli'),
        ),
      ).toBe(true);
    }));

  it('푸시 검사에서는 실제 커밋을 읽고 작업 파일을 덮어쓰지 않는다', () =>
    fixture(({ cwd, git, calls }) => {
      writeFileSync(join(cwd, 'README.md'), 'BAD committed copy');
      git('add', 'README.md');
      git('commit', '-qm', '검사 fixture');
      const sha = git('rev-parse', 'HEAD');
      writeFileSync(join(cwd, 'README.md'), 'Safe working copy');
      const result = spawnSync(process.execPath, [resolve('scripts/check-copy.mjs'), '--push'], {
        cwd,
        encoding: 'utf8',
        input: `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`,
        env: {
          ...process.env,
          PATH: `${cwd}${delimiter}${process.env.PATH}`,
          COPY_LOG: join(cwd, 'calls.jsonl'),
        },
      });
      expect(result.status).toBe(1);
      expect(
        calls()
          .filter((call) => call.args.includes('--score'))
          .every((call) => call.text === 'BAD committed copy'),
      ).toBe(true);
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Safe working copy');
    }));

  it('Codex 재작성 프로세스에 high 설정을 직접 전달한다', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'copy-codex-'));
    try {
      const executable = join(cwd, 'capture');
      writeFileSync(
        executable,
        '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n',
      );
      chmodSync(executable, 0o755);
      const capture = spawnSync(
        process.execPath,
        [resolve('scripts/patina-bin/codex'), 'exec', '--model', 'gpt-6.1-sol'],
        {
          encoding: 'utf8',
          env: { ...process.env, PATINA_CODEX_EXECUTABLE: executable },
        },
      );
      expect(JSON.parse(capture.stdout)).toEqual([
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
