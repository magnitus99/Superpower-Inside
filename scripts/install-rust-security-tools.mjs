import { createRustRunner } from './rust-process.mjs';
import { scriptMain } from './script-process.mjs';

export const securityTools = [
  ['wasm-bindgen-cli', '0.2.123', 'wasm-bindgen'],
  ['cargo-deny', '0.19.8', 'cargo-deny'],
  ['cargo-audit', '0.22.2', 'cargo-audit'],
  ['cargo-geiger', '0.13.0', 'cargo-geiger', '--features', 'vendored-openssl'],
  ['cargo-vet', '0.10.2', 'cargo-vet'],
];

export function installCargoTool(
  rust,
  [name, version, binary, ...args],
  pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      rust.cargo(['install', name, '--version', version, '--locked', '--force', ...args]);
    } catch (error) {
      if (attempt === 3) throw error;
      console.error(`${name} 설치 실패. ${attempt * 10}초 후 재시도합니다.`);
      pause(attempt * 10_000);
      continue;
    }
    rust.run(binary, ['--version']);
    return;
  }
}

scriptMain(import.meta.url, () => {
  const rust = createRustRunner({
    extraEnv: { CARGO_HTTP_MULTIPLEXING: 'false', CARGO_NET_RETRY: '10' },
  });
  rust.prepare();
  for (const tool of securityTools) installCargoTool(rust, tool);
});
