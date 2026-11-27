import { delimiter, dirname, join } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { cargoPrefix, prependCargoBin, rustToolchain, rustVersion } from './rust-tool-versions.mjs';
import { capture, run } from './script-process.mjs';

// 작업 중에는 기존 Rust 검사 중 fmt·clippy·tests만 오프라인으로 실행합니다.
prependCargoBin();
const options = { cwd: process.cwd() };
process.env.RUSTUP_AUTO_INSTALL = '0';
process.env.RUSTUP_TOOLCHAIN = rustToolchain;
process.env.CARGO_TARGET_DIR = join(options.cwd, ARTIFACT_PATHS.rust, `rustup-${rustVersion}`);
process.env.CARGO_NET_OFFLINE = 'true';
const cargo = capture('rustup', ['which', '--toolchain', rustToolchain, 'cargo'], options).trim();
if (cargo) process.env.PATH = `${dirname(cargo)}${delimiter}${process.env.PATH ?? ''}`;
run('rustup', [...cargoPrefix, 'fmt', '--all', '--check'], options);
run('rustup', [...cargoPrefix, 'clippy', '--workspace', '--all-targets', '--all-features', '--frozen', '--', '-D', 'warnings'], options);
run('rustup', [...cargoPrefix, 'test', '--workspace', '--frozen'], options);
