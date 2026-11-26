import { delimiter, dirname, join } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { capture, run } from './script-process.mjs';

// 작업 중에는 기존 Rust 검사 중 fmt·clippy·tests만 오프라인으로 실행합니다.
const toolchain = '1.96.0';
const options = { cwd: process.cwd() };
process.env.RUSTUP_TOOLCHAIN = toolchain;
process.env.CARGO_TARGET_DIR = join(options.cwd, ARTIFACT_PATHS.rust, `rustup-${toolchain}`);
process.env.CARGO_NET_OFFLINE = 'true';
const cargo = capture('rustup', ['which', '--toolchain', toolchain, 'cargo'], options).trim();
if (cargo) process.env.PATH = `${dirname(cargo)}${delimiter}${process.env.PATH ?? ''}`;
const prefix = ['run', toolchain, 'cargo'];
run('rustup', [...prefix, 'fmt', '--all', '--check'], options);
run('rustup', [...prefix, 'clippy', '--workspace', '--all-targets', '--all-features', '--frozen', '--', '-D', 'warnings'], options);
run('rustup', [...prefix, 'test', '--workspace', '--frozen'], options);
