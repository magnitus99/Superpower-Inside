import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export const rustVersion = '1.100.0';
export const bindgenVersion = '0.2.130';
export const rustTarget = 'wasm32-unknown-unknown';
export const cargoBin = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'bin');

// Windows는 rustup의 전역 호스트 설정과 무관하게 네이티브 MSVC를 선택합니다.
const msvcArch = { x64: 'x86_64', arm64: 'aarch64', ia32: 'i686' }[process.arch];
export const rustToolchain = process.platform === 'win32' && msvcArch
  ? `${rustVersion}-${msvcArch}-pc-windows-msvc`
  : rustVersion;
export const cargoPrefix = ['run', rustToolchain, 'cargo'];

export function prependCargoBin() {
  process.env.PATH = [cargoBin, process.env.PATH ?? process.env.Path ?? ''].join(delimiter);
}
