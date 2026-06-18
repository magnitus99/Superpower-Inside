#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

export function buildFishInvocation({ platform, scriptArgs, wslCwd }) {
  if (!scriptArgs?.length) {
    throw new Error('Usage: node scripts/run-fish.mjs <script.fish> [args...]');
  }

  if (platform === 'win32') {
    if (!wslCwd) {
      throw new Error('WSL working directory is required on Windows.');
    }

    return {
      command: 'wsl.exe',
      args: ['--cd', wslCwd, 'fish', ...scriptArgs],
    };
  }

  return {
    command: 'fish',
    args: scriptArgs,
  };
}

export function normalizeWindowsPathForWsl(windowsPath) {
  return windowsPath.replaceAll('\\', '/');
}

export function convertWindowsPathToWsl(cwd) {
  const result = spawnSync('wsl.exe', ['wslpath', '-a', normalizeWindowsPathForWsl(cwd)], {
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`Unable to run wsl.exe: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(`Unable to convert Windows path for WSL.${details ? ` ${details}` : ''}`);
  }

  return result.stdout.trim();
}

function run() {
  const scriptArgs = process.argv.slice(2);
  const wslCwd = process.platform === 'win32' ? convertWindowsPathToWsl(process.cwd()) : undefined;
  const invocation = buildFishInvocation({
    platform: process.platform,
    scriptArgs,
    wslCwd,
  });

  const result = spawnSync(invocation.command, invocation.args, {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.signal) {
    console.error(`${invocation.command} exited from signal ${result.signal}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  run();
}
