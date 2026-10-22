#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { delimiter } from 'node:path';

const threshold = 15;
const languages = ['en', 'ko'];
// 사용자에게 제품을 소개하거나 사용을 안내하는 문서만 명시적으로 등록합니다.
const copyDocuments = new Set(['README.md']);
// Patina는 pi CLI로 실행합니다. 모델은 환경변수로 바꿀 수 있습니다.
const defaultPiModel = 'openai/gpt-6.1-sol';
const defaultPiThinking = 'high';

export function isCopyPath(file) {
  return copyDocuments.has(file);
}

export function piModel() {
  return process.env.PATINA_PI_MODEL || defaultPiModel;
}

export function piThinking() {
  return process.env.PATINA_PI_THINKING || defaultPiThinking;
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
  const parsed = JSON.parse(result.stdout);
  // npm 12는 --json 출력을 단일 값 배열로 감쌉니다.
  const version = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
    throw new Error('Patina 최신 버전 응답이 잘못되었습니다.');
  }
  console.log(`Patina 최신 버전 ${version}으로 갱신 후 실행합니다.`);
  const execute = (args, input) => {
    // patina-bin의 `claude` shim이 claude-cli 백엔드 호출을 pi 실행으로 넘깁니다.
    const env = {
      ...process.env,
      PATH: `${resolve('scripts/patina-bin')}${delimiter}${process.env.PATH}`,
      PATINA_PI_MODEL: piModel(),
      PATINA_PI_THINKING: piThinking(),
    };
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
  execute.version = version;
  return execute;
}

export function scoreArgs(language, online = true) {
  return [
    '--lang',
    language,
    '--score',
    ...(online ? ['--backend', 'claude-cli'] : ['--offline']),
    '--exit-on',
    String(threshold),
    '--format',
    'json',
  ];
}

function validateOnlineScore(score) {
  validateScore(score, 0, threshold);
  if (
    !Number.isFinite(score.scores?.llm?.overall) ||
    score.scores.llm.overall < 0 ||
    score.scores.llm.overall > threshold
  )
    throw new Error('온라인 모델 점수가 없거나 15점 기준을 초과했습니다.');
}

function checkText(patina, file, text, online = true, scores = []) {
  const failed = [];
  for (const language of languages) {
    const result = patina(scoreArgs(language, online), languageText(text, language));
    try {
      const score = JSON.parse(result.stdout);
      console.log(`${file} [${language}]: ${score.overall ?? '?'} / ${threshold}`);
      validateScore(score, result.status, threshold);
      if (online) validateOnlineScore(score);
      scores.push({
        mode: score.mode,
        overall: score.overall,
        gateResult: score.gateResult,
        scores: { llm: score.scores?.llm ? { overall: score.scores.llm.overall } : null },
      });
    } catch (error) {
      console.error(`${file} [${language}]: ${error.message}\n${result.stdout}`);
      failed.push(language);
    }
  }
  return failed;
}

function rewriteText(patina, original, language, backend = 'claude-cli', model) {
  const result = patina(
    [
      '--lang',
      language,
      '--backend',
      backend,
      ...(model ? ['--model', model] : []),
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

function commitRevision(ref) {
  return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
}

function committedSnapshots(ref) {
  const commit = commitRevision(ref);
  return git(['ls-tree', '-r', '--name-only', '-z', commit])
    .split('\0')
    .filter(isCopyPath)
    .map((file) => {
      const content = git(['show', `${commit}:${file}`]);
      return { file, content, text: content };
    });
}

function snapshots(mode, args) {
  if (mode === '--push') {
    const refs = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
    return refs.flatMap((line) => {
      const [, after, remoteRef, before] = line.trim().split(/\s+/);
      if (!after || !before) throw new Error('잘못된 pre-push 입력입니다.');
      if (/^0+$/.test(after) || !/^refs\/tags\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(remoteRef)) return [];
      const commit = commitRevision(after);
      const version = remoteRef.slice('refs/tags/'.length);
      for (const file of ['manifest.json', 'package.json']) {
        if (JSON.parse(git(['show', `${commit}:${file}`])).version !== version)
          throw new Error(`${file}: 릴리스 태그 ${version}와 버전이 다릅니다.`);
      }
      return committedSnapshots(commit);
    });
  }
  if (mode === '--release-ref') {
    if (!args[0]) throw new Error('--release-ref에는 커밋 또는 태그가 필요합니다.');
    return committedSnapshots(args[0]);
  }
  return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(isCopyPath)
    .map((file) => {
      const content = readFileSync(file, 'utf8');
      return { file, content, text: content };
    });
}

function commitLocal() {
  const diff = command('git', ['diff', '--cached', '--check']);
  if (diff.status !== 0) throw new Error(diff.stdout + diff.stderr);
  console.log('커밋 형식 검사 통과: Patina는 필요할 때 수동으로 실행합니다.');
}

function receiptKey(selected, version) {
  const policy = [
    fileURLToPath(import.meta.url),
    resolve('scripts/patina-bin/claude'),
    resolve('.patina.yaml'),
  ].map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : ''));
  const content = [
    ...new Map(
      selected.map(({ file, text }) => [JSON.stringify({ file, text }), { file, text }]),
    ).values(),
  ].sort((a, b) => a.file.localeCompare(b.file) || a.text.localeCompare(b.text));
  return createHash('sha256')
    .update(
      JSON.stringify({
        content,
        policy,
        version,
        threshold,
        backend: 'claude-cli',
        model: piModel(),
        effort: piThinking(),
      }),
    )
    .digest('hex');
}

function reuseReceipt(file, key, version, count) {
  try {
    const receipt = JSON.parse(readFileSync(file, 'utf8'));
    const age = Date.now() - receipt.checkedAt;
    if (
      receipt.key !== key ||
      receipt.version !== version ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 7 * 86400000 ||
      receipt.scores?.length !== count
    )
      return false;
    receipt.scores.forEach(validateOnlineScore);
    return true;
  } catch {
    return false;
  }
}

function run() {
  const argv = process.argv.slice(2);
  const refresh = argv.includes('--refresh');
  const online = !argv.includes('--offline');
  const [mode = '--worktree', ...args] = argv.filter((arg) => arg !== '--refresh');
  if (
    ![
      '--worktree',
      '--push',
      '--release-ref',
      '--fix',
      '--online',
      '--offline',
      '--commit-local',
    ].includes(mode)
  )
    throw new Error(`알 수 없는 실행 모드: ${mode}`);
  if (mode === '--commit-local') {
    commitLocal();
    return;
  }
  if (mode === '--fix') {
    const [file, language, backend = 'claude-cli', model] = args;
    if (!file || !isCopyPath(file) || !languages.includes(language))
      throw new Error('사용법: npm run copy:fix -- <파일> <en|ko> [백엔드] [모델]');
    const original = readFileSync(file, 'utf8');
    const patina = latestPatina();
    saveRewrite(patina, file, original, rewriteText(patina, original, language, backend, model));
    return;
  }
  const selected = snapshots(mode, args);
  if (!selected.length) {
    console.log('Patina: 검사할 릴리스 문구가 없습니다.');
    return;
  }
  const patina = latestPatina();
  const unique = [...new Map(selected.map((snapshot) => [snapshot.text, snapshot])).values()];
  const key = receiptKey(selected, patina.version);
  const receiptFile = git(['rev-parse', '--git-path', 'patina-release.json']).trim();
  // 전체 릴리스 문구의 성공만 재사용하며 오프라인 검사는 증명으로 저장하지 않습니다.
  if (
    online &&
    !refresh &&
    reuseReceipt(receiptFile, key, patina.version, unique.length * languages.length)
  ) {
    console.log('Patina: 동일 문구·최신 버전·정책의 온라인 통과 기록을 재사용합니다.');
    return;
  }
  const scores = [];
  let passed = true;
  for (const snapshot of unique) {
    if (checkText(patina, snapshot.file, snapshot.text, online, scores).length) passed = false;
  }
  if (!passed) {
    console.error(
      '홍보 문구를 수정한 뒤 npm run copy:check로 재검사하세요. 명시적 재작성: npm run copy:fix -- <파일> <en|ko>',
    );
    process.exitCode = 1;
  } else if (online) {
    writeFileSync(
      receiptFile,
      JSON.stringify({ key, version: patina.version, checkedAt: Date.now(), scores }),
    );
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
