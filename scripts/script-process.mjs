import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnNodeToolSync } from './run-node-tool.mjs';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function hasCommand(command) {
  const names = process.platform === 'win32' && !/\.(exe|com)$/i.test(command)
    ? [`${command}.exe`, `${command}.com`]
    : [command];
  return (process.env.PATH ?? process.env.Path ?? '').split(delimiter).some((directory) =>
    directory && names.some((name) => {
      const path = join(directory.replace(/^"|"$/g, ''), name);
      try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
      } catch {
        return false;
      }
    }),
  );
}

function checked(command, args, options) {
  const result = spawnNodeToolSync(command, args, { cwd: root, ...options, shell: false });
  if (result.error || result.signal || result.status !== 0) {
    if (result.error) console.error(`${command}: ${result.error.message}`);
    if (result.signal) console.error(`${command}: ${result.signal} 신호로 종료되었습니다.`);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

export function run(command, args = [], options = {}) {
  checked(command, args, { stdio: 'inherit', ...options });
}

export function capture(command, args = [], options = {}) {
  return checked(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
}

export function npm(args, options = {}) {
  const cli = (options.env ?? process.env).npm_execpath;
  if (cli) run(process.execPath, [cli, ...args], options);
  else run('npm', args, options);
}
