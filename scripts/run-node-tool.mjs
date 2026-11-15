import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export function nodeToolInvocation(program, args, {
  platform = process.platform,
  environment = process.env,
  execPath = process.execPath,
} = {}) {
  if (platform !== 'win32' || !['npm', 'patina'].includes(program)) {
    return { command: program, args };
  }
  // Node 스크립트는 .cmd 셸을 거치지 않아 인자를 그대로 보존합니다.
  for (const directory of (environment.PATH ?? environment.Path ?? '').split(delimiter)) {
    if (!directory) continue;
    const script = join(directory, program);
    if (!existsSync(script) || !statSync(script).isFile() || statSync(script).size > 65536) continue;
    if (/^#![^\r\n]*\bnode(?:\.exe)?(?:\s|$)/.test(readFileSync(script, 'utf8'))) {
      return { command: execPath, args: [script, ...args] };
    }
  }
  if (program === 'npm') {
    const cli = join(dirname(execPath), 'node_modules/npm/bin/npm-cli.js');
    if (existsSync(cli)) return { command: execPath, args: [cli, ...args] };
  }
  return { command: program, args };
}

export function spawnNodeToolSync(program, args, options = {}) {
  const invocation = nodeToolInvocation(program, args, { environment: options.env ?? process.env });
  return spawnSync(invocation.command, invocation.args, options);
}
