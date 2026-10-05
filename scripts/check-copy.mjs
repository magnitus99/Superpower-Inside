#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { delimiter } from 'node:path';

const threshold = 15;
const languages = ['en', 'ko'];

export function isCopyPath(file) {
  if (/(^|\/)AGENTS\.md$/i.test(file)) return false;
  return (
    /(^|\/)README[^/]*\.(md|mdx|txt)$/i.test(file) ||
    /^(docs|marketing|copy|public|releases)\/.*\.(md|mdx|txt|rst|adoc)$/i.test(file) ||
    ['package.json', 'manifest.json'].includes(file)
  );
}

export function languageText(text, language) {
  const boundary = /^## 한국어\s*$/m.exec(text);
  if (!boundary) return text;
  return language === 'en' ? text.slice(0, boundary.index) : text.slice(boundary.index);
}

export function validateScore(result, status, gate) {
  if (
    status !== 0 ||
    result.mode !== 'score' ||
    !Number.isFinite(result.overall) ||
    result.overall < 0 ||
    result.overall > gate ||
    result.gateResult?.passed !== true ||
    result.gateResult.threshold !== gate ||
    result.gateResult.exitCode !== 0
  ) {
    throw new Error(`점수 검사 실패: ${result.overall ?? '알 수 없음'} / 기준 ${gate}`);
  }
  return result.overall;
}

export function validateRewrite(result, status) {
  const proof = result.verification;
  if (
    status !== 0 ||
    typeof result.output !== 'string' ||
    !result.output.trim() ||
    proof?.verified !== true ||
    !Number.isFinite(proof.mps) ||
    proof.mps < 95 ||
    !Number.isFinite(proof.fidelity) ||
    proof.fidelity < 95 ||
    proof.outputHash !== createHash('sha256').update(result.output).digest('hex')
  ) {
    throw new Error('재작성 의미 보존 검증 실패: 원본을 유지합니다.');
  }
  return result.output;
}

export function pushRevisions(input) {
  return [
    ...new Set(
      input
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(/\s+/)[1])
        .filter((sha) => sha && !/^0+$/.test(sha)),
    ),
  ];
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.signal || result.status === null) {
    throw result.error ?? new Error(`${program} 실행 중단: ${result.signal}`);
  }
  return result;
}

function git(args) {
  const result = command('git', args);
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout;
}

function latestPatina() {
  const result = command('npm', [
    'view',
    'patina-cli@latest',
    'version',
    '--json',
    '--prefer-online',
  ]);
  if (result.status !== 0) throw new Error(`Patina 최신 버전 확인 실패: ${result.stderr.trim()}`);
  const version = JSON.parse(result.stdout);
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
    throw new Error('Patina 최신 버전 응답이 잘못되었습니다.');
  }
  console.log(`Patina 최신 버전 ${version}으로 갱신 후 실행합니다.`);
  return (args, input) => {
    let env = process.env;
    if (args.includes('codex-cli')) {
      const located = command(process.platform === 'win32' ? 'where' : 'which', ['codex']);
      if (located.status !== 0)
        throw new Error('Codex CLI가 필요합니다. codex login 후 다시 실행하세요.');
      env = {
        ...process.env,
        PATINA_CODEX_EXECUTABLE: located.stdout.trim().split(/\r?\n/)[0],
        PATH: `${resolve('scripts/patina-bin')}${delimiter}${process.env.PATH}`,
      };
    }
    const execution = command(
      'npm',
      [
        'exec',
        '--yes',
        '--prefer-online',
        '--ignore-scripts',
        `--package=patina-cli@${version}`,
        '--',
        'patina',
        ...args,
        '--no-interactive',
      ],
      { input, env },
    );
    if (execution.stderr.trim()) console.error(execution.stderr.trim());
    return execution;
  };
}

export function scoreArgs(language, online = true) {
  return [
    '--lang',
    language,
    '--score',
    ...(online ? ['--backend', 'codex-cli', '--model', 'gpt-6.1-sol'] : ['--offline']),
    '--exit-on',
    String(threshold),
    '--format',
    'json',
  ];
}

function checkText(patina, file, text, online = true) {
  const failed = [];
  for (const language of languages) {
    const result = patina(scoreArgs(language, online), languageText(text, language));
    try {
      const score = JSON.parse(result.stdout);
      console.log(`${file} [${language}]: ${score.overall ?? '?'} / ${threshold}`);
      validateScore(score, result.status, threshold);
      if (
        online &&
        (!Number.isFinite(score.scores?.llm?.overall) ||
          score.scores.llm.overall < 0 ||
          score.scores.llm.overall > threshold)
      ) {
        throw new Error('온라인 모델 점수가 없거나 15점 기준을 초과했습니다.');
      }
    } catch (error) {
      console.error(`${file} [${language}]: ${error.message}\n${result.stdout}`);
      failed.push(language);
    }
  }
  return failed;
}

function rewriteText(patina, original, language, backend = 'codex-cli', model = 'gpt-6.1-sol') {
  const result = patina(
    [
      '--lang',
      language,
      '--backend',
      backend,
      '--model',
      model,
      '--verify',
      '--config',
      resolve('.patina.yaml'),
      '--format',
      'json',
    ],
    languageText(original, language),
  );
  const rewritten = validateRewrite(JSON.parse(result.stdout), result.status);
  return /^## 한국어\s*$/m.test(original)
    ? language === 'en'
      ? `${rewritten.trimEnd()}\n\n${languageText(original, 'ko')}`
      : `${languageText(original, 'en')}${rewritten}`
    : rewritten;
}

function saveRewrite(patina, file, original, candidate) {
  if (checkText(patina, file, candidate).length)
    throw new Error('재작성 후 점수 초과: 원본을 유지합니다.');
  if (readFileSync(file, 'utf8') !== original)
    throw new Error('재작성 중 원본이 변경되어 덮어쓰지 않습니다.');
  writeFileSync(file, candidate);
  console.log(`${file}: 의미 보존·한영 검사 통과 후 저장했습니다. 검토하고 다시 스테이징하세요.`);
}

function copyText(file, content) {
  if (file.endsWith('.json')) {
    const description = JSON.parse(content).description;
    if (typeof description !== 'string' || !description.trim())
      throw new Error(`${file}: description이 없습니다.`);
    return description;
  }
  return content;
}

function snapshots(mode, refs) {
  if (mode === '--staged') {
    return git(['ls-files', '--cached', '-z'])
      .split('\0')
      .filter(isCopyPath)
      .map((file) => ({ file, content: git(['show', `:${file}`]) }));
  }
  if (mode === '--push') {
    return refs.flatMap((ref) =>
      git(['ls-tree', '-r', '--name-only', '-z', `${ref}^{commit}`])
        .split('\0')
        .filter(isCopyPath)
        .map((file) => ({
          file: `${ref.slice(0, 8)}:${file}`,
          content: copyText(file, git(['show', `${ref}:${file}`])),
          extracted: true,
        })),
    );
  }
  return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(isCopyPath)
    .map((file) => ({ file, content: readFileSync(file, 'utf8') }));
}

function run() {
  const [mode = '--worktree', ...args] = process.argv.slice(2);
  if (!['--worktree', '--staged', '--push', '--fix', '--online', '--offline'].includes(mode))
    throw new Error(`알 수 없는 실행 모드: ${mode}`);
  const refs = mode === '--push' ? pushRevisions(readFileSync(0, 'utf8')) : [];
  const patina = latestPatina();
  if (mode === '--fix') {
    const [file, language, backend = 'codex-cli', model = 'gpt-6.1-sol'] = args;
    if (
      !file ||
      !isCopyPath(file) ||
      file.endsWith('.json') ||
      !languages.includes(language) ||
      !backend ||
      !model
    ) {
      throw new Error(
        '사용법: npm run copy:fix -- <파일> <en|ko> [백엔드] [모델] (기본: codex-cli / gpt-6.1-sol / high)',
      );
    }
    const original = readFileSync(file, 'utf8');
    saveRewrite(patina, file, original, rewriteText(patina, original, language, backend, model));
    return;
  }
  let passed = true;
  const seen = new Set();
  for (const snapshot of snapshots(mode, refs)) {
    const text = snapshot.extracted ? snapshot.content : copyText(snapshot.file, snapshot.content);
    const hash = createHash('sha256').update(text).digest('hex');
    if (seen.has(hash)) continue;
    seen.add(hash);
    const failed = checkText(patina, snapshot.file, text, mode !== '--offline');
    if (failed.length) {
      passed = false;
      if (mode === '--staged' && !snapshot.file.endsWith('.json')) {
        try {
          if (readFileSync(snapshot.file, 'utf8') !== snapshot.content) {
            console.error(
              `${snapshot.file}: 스테이징되지 않은 변경을 보존하며 자동 재작성을 건너뜁니다.`,
            );
            continue;
          }
          let candidate = snapshot.content;
          for (const language of failed) candidate = rewriteText(patina, candidate, language);
          saveRewrite(patina, snapshot.file, snapshot.content, candidate);
        } catch (error) {
          console.error(`${snapshot.file}: ${error.message}`);
        }
      }
    }
  }
  if (!passed) {
    console.error(
      '홍보 문구를 수정한 뒤 npm run copy:check로 재검사하세요. Codex는 피드백에 따라 재작성합니다.\nCLI 자동 재작성: npm run copy:fix -- <파일> <en|ko> <백엔드> <선택한 모델>',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
