import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { nodeToolInvocation } from './run-node-tool.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('Windows Node 도구 실행', () => {
  it('셸 없이 공백·셸 메타문자 인자를 보존하고 종료 상태를 전달한다', () => {
    const fixtures = resolve(root, '.thinkrail/context/node-tool-tests');
    mkdirSync(fixtures, { recursive: true });
    const fixture = mkdtempSync(join(fixtures, 'fixture-'));
    const script = join(fixture, 'npm');
    writeFileSync(script, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;');
    const args = ['run', 'argument with spaces', 'literal&|%value'];
    const invocation = nodeToolInvocation('npm', args, {
      platform: 'win32', environment: { PATH: fixture },
    });
    expect(invocation).toEqual({ command: process.execPath, args: [script, ...args] });
    const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8' });
    expect(JSON.parse(result.stdout)).toEqual(args);
    expect(result.status).toBe(7);
  });

  it('다른 실행 파일이나 Unix 실행 방식은 변경하지 않는다', () => {
    const args = ['status', '--short'];
    expect(nodeToolInvocation('git', args, { platform: 'win32' })).toEqual({ command: 'git', args });
    expect(nodeToolInvocation('npm', args, { platform: 'linux' })).toEqual({ command: 'npm', args });
  });
});
