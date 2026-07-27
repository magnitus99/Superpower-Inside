import { describe, expect, it } from 'vitest';

import { buildFishInvocation, normalizeWindowsPathForWsl } from './run-fish.mjs';

describe('run-fish command selection', () => {
  it('uses fish directly on POSIX hosts', () => {
    expect(
      buildFishInvocation({
        platform: 'linux',
        scriptArgs: ['scripts/build-rag-wasm.fish'],
      }),
    ).toEqual({
      command: 'fish',
      args: ['scripts/build-rag-wasm.fish'],
    });
  });

  it('uses WSL fish from the converted working directory on Windows', () => {
    expect(
      buildFishInvocation({
        platform: 'win32',
        scriptArgs: ['scripts/check-rust-security.fish'],
        wslCwd: '/mnt/d/Repository/Super-Obsidian-by-AI',
      }),
    ).toEqual({
      command: 'wsl.exe',
      args: [
        '--cd',
        '/mnt/d/Repository/Super-Obsidian-by-AI',
        'fish',
        'scripts/check-rust-security.fish',
      ],
    });
  });

  it('requires a converted WSL working directory on Windows', () => {
    expect(() =>
      buildFishInvocation({
        platform: 'win32',
        scriptArgs: ['scripts/build-rag-wasm.fish'],
      }),
    ).toThrow('WSL working directory');
  });

  it('normalizes Windows backslashes before calling wslpath', () => {
    expect(normalizeWindowsPathForWsl(String.raw`D:\Repository\Super-Obsidian-by-AI`)).toBe(
      'D:/Repository/Super-Obsidian-by-AI',
    );
  });
});
