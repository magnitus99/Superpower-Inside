import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function commandInvocation(command, args, { platform = process.platform, npmCli } = {}) {
  if (command === 'npm' && platform === 'win32') {
    const cli =
      npmCli ??
      process.env.npm_execpath ??
      resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (!npmCli && !existsSync(cli))
      throw new Error('npm CLI를 찾을 수 없습니다. Node.js 설치를 확인하세요.');
    return { command: process.execPath, args: [cli, ...args] };
  }
  return { command, args };
}

export function spawnCommand(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  return spawnSync(invocation.command, invocation.args, { windowsHide: true, ...options });
}

export function runCommand(command, args, options = {}) {
  const result = spawnCommand(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.signal || result.status !== 0) {
    throw Object.assign(
      result.error ?? new Error(`${command} 실행 실패: ${result.signal ?? result.status}`),
      { exitCode: result.status || 1 },
    );
  }
  return result.stdout;
}

export function scriptMain(url, run) {
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url)) {
    try {
      run();
    } catch (error) {
      console.error(error.message);
      process.exitCode = error.exitCode || 1;
    }
  }
}
