import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { repoRoot, runCommand } from './script-process.mjs';

export const toolchain = '1.96.0';

export function rustInvocation(command, args, { useWsl, cwd, env = {} }) {
  if (!useWsl) return { command, args };
  return {
    command: 'wsl.exe',
    args: [
      '--cd',
      cwd,
      '--exec',
      'env',
      ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
      command,
      ...args,
    ],
  };
}

export function createRustRunner({
  cwd = repoRoot,
  local = false,
  security = false,
  extraEnv = {},
} = {}) {
  const channel = readFileSync(join(cwd, 'rust-toolchain.toml'), 'utf8').match(
    /channel\s*=\s*"([^"]+)"/,
  )?.[1];
  if (channel !== toolchain) throw new Error(`Rust 버전은 ${toolchain}이어야 합니다: ${channel}`);
  const cargoBin = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'bin');
  const env = { ...process.env, PATH: `${cargoBin}${delimiter}${process.env.PATH}` };
  const probe = spawnSync('rustup', ['--version'], { env, windowsHide: true, encoding: 'utf8' });
  const useWsl = process.platform === 'win32' && probe.error?.code === 'ENOENT';
  let rustCwd = cwd;
  if (useWsl) {
    rustCwd = runCommand('wsl.exe', ['--exec', 'wslpath', '-a', cwd.replaceAll('\\', '/')], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    console.log('Windows Rust 도구가 없어 Rust 명령만 WSL에서 실행합니다.');
  } else if (probe.error || probe.status !== 0) {
    throw probe.error ?? new Error('rustup 실행 실패');
  }
  const targetDir =
    security || local
      ? join(cwd, 'target', `rustup-${toolchain}`)
      : resolve(cwd, process.env.CARGO_TARGET_DIR || 'target');
  const pathForRust = (path) =>
    useWsl
      ? runCommand('wsl.exe', ['--exec', 'wslpath', '-a', path.replaceAll('\\', '/')], {
          encoding: 'utf8',
          stdio: 'pipe',
        }).trim()
      : path;
  const overrides = {
    ...extraEnv,
    RUSTUP_TOOLCHAIN: toolchain,
    CARGO_TARGET_DIR: pathForRust(targetDir),
    ...(local ? { CARGO_NET_OFFLINE: 'true' } : {}),
  };
  // 로그인 셸 없이 설치된 cargo 도구의 경로를 명시합니다.
  if (useWsl) {
    const linuxPath = runCommand(
      'wsl.exe',
      ['--exec', 'sh', '-lc', 'printf "%s/.cargo/bin:%s" "$HOME" "$PATH"'],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
    overrides.PATH = linuxPath;
  }
  const run = (command, args, options = {}) => {
    const invocation = rustInvocation(command, args, { useWsl, cwd: rustCwd, env: overrides });
    return runCommand(invocation.command, invocation.args, {
      cwd,
      env: useWsl ? env : { ...env, ...overrides },
      ...options,
    });
  };
  const cargo = (args) => run('rustup', ['run', toolchain, 'cargo', ...args]);
  const prepare = () => {
    run('rustup', ['toolchain', 'install', toolchain, '--profile', 'minimal']);
    run('rustup', ['component', 'add', 'clippy', 'rustfmt', '--toolchain', toolchain]);
    run('rustup', ['target', 'add', 'wasm32-unknown-unknown', '--toolchain', toolchain]);
  };
  return { run, cargo, prepare, targetDir, pathForRust };
}
