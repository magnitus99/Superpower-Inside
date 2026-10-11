#!/usr/bin/env node
import { basename, dirname, join } from 'node:path';
import { runCommand, scriptMain } from './script-process.mjs';

export function buildFishInvocation({ platform = process.platform, scriptArgs }) {
  if (!scriptArgs?.length)
    throw new Error('사용법: node scripts/run-fish.mjs <script.fish> [args...]');
  if (platform !== 'win32') return { command: 'fish', args: scriptArgs };
  const [script, ...args] = scriptArgs;
  const name = basename(script, '.fish');
  if (['setup-dev', 'launch-obsidian-debug'].includes(name)) {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-File', join(dirname(script), name + '.ps1'), ...args],
    };
  }
  if (
    ![
      'build-rag-wasm',
      'copy-ternlight-assets',
      'check-rust-security',
      'check-rust-local',
      'check-release',
      'bench-rag-core',
      'bump-version',
      'install-rust-security-tools',
    ].includes(name)
  ) {
    throw new Error('Windows 네이티브 진입점이 없는 fish 스크립트입니다: ' + script);
  }
  return { command: process.execPath, args: [join(dirname(script), name + '.mjs'), ...args] };
}

scriptMain(import.meta.url, () => {
  const invocation = buildFishInvocation({ scriptArgs: process.argv.slice(2) });
  runCommand(invocation.command, invocation.args);
});
