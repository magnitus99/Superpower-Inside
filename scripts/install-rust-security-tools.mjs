import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { hasCommand } from './script-process.mjs';

function execute(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) console.error(`${command}: ${result.error.message}`);
  return result.status ?? 1;
}

export async function installRustSecurityTools(run = execute, delay = setTimeout) {
  const home = homedir();
  const cargoBin = join(home, '.cargo', 'bin');
  const exe = process.platform === 'win32' ? '.exe' : '';
  process.env.CARGO_HTTP_MULTIPLEXING = 'false';
  process.env.CARGO_NET_RETRY = '10';
  process.env.PATH = [join(home, '.local', 'bin'), cargoBin, process.env.PATH ?? ''].join(delimiter);

  for (const [pkg, version, binary, ...flags] of [
    ['wasm-bindgen-cli', '0.2.123', 'wasm-bindgen'],
    ['cargo-deny', '0.19.8', 'cargo-deny'],
    ['cargo-audit', '0.22.2', 'cargo-audit'],
    ['cargo-geiger', '0.13.0', 'cargo-geiger', '--features', 'vendored-openssl'],
    ['cargo-vet', '0.10.2', 'cargo-vet'],
  ]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`==> cargo install ${pkg} ${version} (attempt ${attempt}/3)`);
      const status = run('cargo', ['install', pkg, '--version', version, '--locked', '--force', ...flags]);
      if (status === 0) {
        let installed = join(cargoBin, `${binary}${exe}`);
        try {
          accessSync(installed, constants.X_OK);
        } catch {
          installed = hasCommand(binary) ? binary : null;
        }
        if (installed) run(installed, ['--version']);
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
