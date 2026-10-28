import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function metadataOnly(file, before, after) {
  try {
    const normalize = (text) => {
      const value = JSON.parse(text);
      delete value.version;
      if (file === 'package.json') delete value.description;
      if (file === 'package-lock.json' && value.packages?.['']) delete value.packages[''].version;
      return JSON.stringify(value);
    };
    return normalize(before) === normalize(after);
  } catch {
    return false;
  }
}

export function qualityPlan(
  files,
  metadata = new Set(),
  packageDependencies = new Set(['package.json']),
) {
  const changed = files.filter((file) => !metadata.has(file));
  const rust = changed.some((file) =>
    /^(crates\/|Cargo\.(toml|lock)$|rust-toolchain\.toml$|scripts\/(build-rag-wasm|check-rust-security|check-rust-local)\.fish$)/.test(
      file,
    ),
  );
  const typescript =
    rust ||
    changed.some((file) =>
      /^(src\/.*\.(ts|tsx|js|mjs|cjs)$|main\.ts$|tsconfig.*\.json$|eslint\.config\.|vitest\.config\.|generated\/.*\.(ts|js)$)/.test(
        file,
      ),
    ) ||
    (packageDependencies.has('package.json') && changed.includes('package.json'));
  const tests =
    typescript ||
    changed.some((file) =>
      /^(src\/.*\.json$|scripts\/.*\.(mjs|fish)$|\.githooks\/|esbuild\.config\.mjs$|styles\.css$|package\.json$|tests\/fixtures\/)/.test(
        file,
      ),
    );
  const contracts = changed.some((file) =>
    /^(src\/i18n\.ts$|src\/(chat|search)\/.*\.(ts|tsx|css)$|styles\.css$|tests\/fixtures\/chat-ux\/|scripts\/(check-i18n|check-chat-ux-fixtures|evaluate-chat-quality)\.mjs$)/.test(
      file,
    ),
  );
  const ui = changed.some((file) =>
    /^(styles\.css$|src\/(chat|search)\/.*\.(ts|tsx|css)$|design\.md$|scripts\/obsidian-preview(\.mjs|\/))/.test(
      file,
    ),
  );
  return {
    typescript,
    tests,
    contracts,
    ui,
    rust,
    review: files.length > 0,
    workflows: changed.some((file) => file.startsWith('.github/workflows/')),
    security:
      changed.some((file) =>
        /^(Cargo\.(lock|toml)$|package-lock\.json$|deny\.toml$|supply-chain\/)/.test(file),
      ) ||
      (changed.includes('package.json') && packageDependencies.has('package.json')),
  };
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (required && (result.error || result.status !== 0))
    throw result.error ?? new Error(result.stderr);
  return result.status === 0 ? result.stdout : null;
}

function run() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  const base = baseIndex < 0 ? 'HEAD' : args[baseIndex + 1];
  if (baseIndex >= 0 && !base) throw new Error('--base에는 비교할 커밋이 필요합니다.');
  if (base && !/^0+$/.test(base))
    git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const files = [
    ...new Set(
      [
        ...git(
          base && !/^0+$/.test(base)
            ? ['diff', '--name-only', '-z', '--no-renames', base, '--']
            : ['ls-files', '-z'],
        ).split('\0'),
        ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
      ].filter(Boolean),
    ),
  ];
  const metadata = new Set(),
    packageDependencies = new Set();
  for (const file of files.filter((file) => ['package.json', 'package-lock.json'].includes(file))) {
    const before = base && !/^0+$/.test(base) ? git(['show', `${base}:${file}`], false) : null;
    let after;
    try {
      after = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (metadataOnly(file, before, after)) metadata.add(file);
    if (file === 'package.json') {
      try {
        const previous = JSON.parse(before),
          current = JSON.parse(after);
        if (
          [
            'dependencies',
            'devDependencies',
            'optionalDependencies',
            'peerDependencies',
            'overrides',
          ].some((key) => JSON.stringify(previous[key]) !== JSON.stringify(current[key]))
        )
          packageDependencies.add(file);
      } catch {
        packageDependencies.add(file);
      }
    }
  }
  const plan = qualityPlan(files, metadata, packageDependencies);
  if (args.includes('--plan')) {
    for (const [key, value] of Object.entries(plan)) console.log(`${key}=${value}`);
    return;
  }
  const commands = [];
  if (plan.typescript) commands.push(['npm', ['run', 'lint']], ['npm', ['run', 'typecheck']]);
  if (plan.tests) commands.push(['npm', ['run', 'test:unit']]);
  if (plan.contracts) commands.push(['npm', ['run', 'test:contracts']]);
  if (plan.rust) commands.push(['npm', ['run', 'rust:check']]);
  if (plan.review) commands.push(['npm', ['run', 'review']]);
  commands.push(['npm', ['run', 'vault:leak-check']]);
  commands.push(['git', ['diff', '--check']], ['git', ['diff', '--cached', '--check']]);
  if (!plan.tests && !plan.contracts && !plan.rust)
    console.log('문서·메타데이터 변경: 코드·Rust·모델 검사를 생략합니다.');
  if (plan.security)
    console.log('의존성·보안 변경: CI 또는 릴리스 전에 `npm run security:full`을 실행합니다.');
  if (plan.ui)
    console.log(
      'UI 변경: 커밋 전에 `npm run preview:verify`로 고정 뷰포트 스크린샷과 DOM 계약을 확인합니다.',
    );
  for (const [program, commandArgs] of commands) {
    const result = spawnSync(program, commandArgs, { stdio: 'inherit' });
    if (result.error || result.status !== 0)
      throw result.error ?? new Error(`${program} ${commandArgs.join(' ')} 실패`);
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
