#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const threshold = 15;
const languages = ['en', 'ko'];
// 사용자에게 제품을 소개하거나 사용을 안내하는 매체만 명시적으로 등록합니다.
const copyDocuments = new Set(['README.md']);

export function isCopyPath(file) {
  return copyDocuments.has(file);
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

export function onlineSettings(environment = process.env) {
  const model = environment.PATINA_PI_MODEL?.trim();
  const thinking = environment.PATINA_PI_THINKING?.trim();
  if (!model || !thinking) {
    throw new Error(
      '온라인 Patina 검사에는 실행할 모델과 추론 강도를 지정해야 합니다. ' +
        '예: PATINA_PI_MODEL=<provider/model> PATINA_PI_THINKING=<level> npm run copy:check:online',
    );
  }
  return { model, thinking };
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
  console.log(`Patina 최신 버전 ${version}으로 온라인 검사를 실행합니다.`);
  return version;
}

function onlinePatina() {
  const { model, thinking } = onlineSettings();
  const version = latestPatina();
  const execute = (args, input) => {
    // patina-bin의 `claude` shim이 claude-cli 백엔드 호출을 pi 실행으로 넘깁니다.
    const env = {
      ...process.env,
      PATH: `${resolve('scripts/patina-bin')}${delimiter}${process.env.PATH}`,
      PATINA_PI_MODEL: model,
      PATINA_PI_THINKING: thinking,
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

function offlinePatina() {
  const execute = (args, input) => {
    try {
      const execution = command('patina', [...args, '--no-interactive'], { input });
      if (execution.stderr.trim()) console.error(execution.stderr.trim());
      return execution;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error;
    }
    // 전역 설치가 없으면 npm 캐시의 Patina CLI를 사용합니다. 이 경로는 모델을
    // 호출하지 않고 Patina의 결정적 --offline 점수만 실행합니다.
    const execution = command(
      'npm',
      [
        'exec',
        '--yes',
        '--prefer-offline',
        '--ignore-scripts',
        '--package=patina-cli',
        '--',
        'patina',
        ...args,
        '--no-interactive',
      ],
      { input },
    );
    if (execution.stderr.trim()) console.error(execution.stderr.trim());
    return execution;
  };
  execute.version = null;
  return execute;
}

function createPatina(online) {
  return online ? onlinePatina() : offlinePatina();
}

export function scoreArgs(language, online = false) {
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

function checkText(patina, file, text, online) {
  const failed = [];
  for (const language of languages) {
    const result = patina(scoreArgs(language, online), languageText(text, language));
    try {
      const score = JSON.parse(result.stdout);
      console.log(
        `${file} [${language}] ${online ? '온라인' : '오프라인'}: ${score.overall ?? '?'} / ${threshold}`,
      );
      validateScore(score, result.status, threshold);
      if (online) validateOnlineScore(score);
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

function saveRewrite(patina, file, original, candidate, online) {
  if (checkText(patina, file, candidate, online).length)
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

function run() {
  const argv = process.argv.slice(2);
  const online = argv.includes('--online');
  if (online && argv.includes('--offline')) throw new Error('--online과 --offline은 함께 쓸 수 없습니다.');
  if (online) onlineSettings();
  const [mode = '--worktree', ...args] = argv.filter(
    (arg) => arg !== '--online' && arg !== '--offline',
  );
  if (!['--worktree', '--release-ref', '--fix'].includes(mode))
    throw new Error(`알 수 없는 실행 모드: ${mode}`);
  if (mode === '--fix') {
    const [file, language, backend = 'claude-cli', model] = args;
    if (!file || !isCopyPath(file) || !languages.includes(language))
      throw new Error('사용법: npm run copy:fix -- <파일> <en|ko> [백엔드] [모델]');
    const original = readFileSync(file, 'utf8');
    const patina = createPatina(true);
    saveRewrite(
      patina,
      file,
      original,
      rewriteText(patina, original, language, backend, model),
      true,
    );
    return;
  }
  const selected = snapshots(mode, args);
  if (!selected.length) {
    console.log('Patina: 검사할 릴리스 문구가 없습니다.');
    return;
  }
  const patina = createPatina(online);
  const unique = [...new Map(selected.map((snapshot) => [snapshot.text, snapshot])).values()];
  let passed = true;
  for (const snapshot of unique) {
    if (checkText(patina, snapshot.file, snapshot.text, online).length) passed = false;
  }
  if (!passed) {
    console.error(
      '홍보 문구를 수정한 뒤 다시 검사하세요. 온라인 재검사는 모델·추론 강도를 지정해 수동으로 실행합니다.',
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
