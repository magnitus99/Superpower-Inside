import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { bindgenVersion, cargoBin, cargoPrefix, prependCargoBin } from './rust-tool-versions.mjs';

function execute(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) console.error(`${command}: ${result.error.message}`);
  return result.status ?? 1;
}

function isExecutableFile(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export async function installRustSecurityTools(run = execute, delay = setTimeout) {
  const home = homedir();
  const exe = process.platform === 'win32' ? '.exe' : '';
  const installBin = resolve(cargoBin);
  const installRoot = dirname(installBin);
  process.env.CARGO_HTTP_MULTIPLEXING = 'false';
  process.env.CARGO_NET_RETRY = '10';
  process.env.PATH = [join(home, '.local', 'bin'), process.env.PATH ?? process.env.Path ?? ''].join(delimiter);
  prependCargoBin();

  for (const [pkg, version, binary, ...flags] of [
    ['wasm-bindgen-cli', bindgenVersion, 'wasm-bindgen'],
    ['cargo-deny', '0.19.8', 'cargo-deny'],
    ['cargo-audit', '0.22.2', 'cargo-audit'],
    ['cargo-geiger', '0.13.0', 'cargo-geiger', '--features', 'vendored-openssl'],
    ['cargo-vet', '0.10.2', 'cargo-vet'],
  ]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`==> cargo install ${pkg} ${version} (attempt ${attempt}/3)`);
      const status = run('rustup', [
        ...cargoPrefix, 'install', pkg, '--version', version, '--locked', '--force', '--root', installRoot, ...flags,
      ]);
      if (status === 0) {
        // PATH에 있는 다른 도구가 이번 설치 대상의 누락을 가리지 못하게 합니다.
        const installed = join(installBin, `${binary}${exe}`);
        if (!isExecutableFile(installed)) {
          console.error(`ERROR: ${pkg} 설치 후 ${binary} 실행 파일을 찾을 수 없습니다: ${installed}`);
          return 1;
        }
        const versionStatus = run(installed, ['--version']);
        if (versionStatus !== 0) {
          console.error(`ERROR: ${installed} --version 실패 (종료 코드: ${versionStatus})`);
          return versionStatus;
        }
        break;
      }
      if (attempt === 3) {
        console.error(`ERROR: ${pkg} 설치 실패`);
        return status;
      }
      const seconds = attempt * 10;
      console.warn(`WARN: ${pkg} 설치 실패. ${seconds}초 후 재시도합니다.`);
      await delay(seconds * 1000);
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await installRustSecurityTools();
}
