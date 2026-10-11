import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFishInvocation } from './run-fish.mjs';

describe('fish 호환 진입점', () => {
  it('POSIX에서는 기존 fish 호출을 유지한다', () => {
    expect(
      buildFishInvocation({ platform: 'linux', scriptArgs: ['scripts/build-rag-wasm.fish'] }),
    ).toEqual({ command: 'fish', args: ['scripts/build-rag-wasm.fish'] });
  });
  it.each([
    'build-rag-wasm',
    'copy-ternlight-assets',
    'check-rust-security',
    'check-rust-local',
    'check-release',
    'bench-rag-core',
    'bump-version',
    'install-rust-security-tools',
  ])('Windows 스크립트는 Node.js로 직접 실행한다: %s', (name) => {
    expect(
      buildFishInvocation({
        platform: 'win32',
        scriptArgs: ['scripts/' + name + '.fish', 'a & b'],
      }),
    ).toEqual({ command: process.execPath, args: [join('scripts', name + '.mjs'), 'a & b'] });
  });
  it.each(['setup-dev', 'launch-obsidian-debug'])(
    'Windows 설정과 실행은 기존 PowerShell을 사용한다: %s',
    (name) => {
      expect(
        buildFishInvocation({ platform: 'win32', scriptArgs: ['scripts/' + name + '.fish'] }),
      ).toEqual({
        command: 'powershell.exe',
        args: ['-NoProfile', '-File', join('scripts', name + '.ps1')],
      });
    },
  );
  it('알 수 없는 스크립트를 WSL로 우회하지 않는다', () => {
    expect(() => buildFishInvocation({ platform: 'win32', scriptArgs: ['unknown.fish'] })).toThrow(
      '네이티브',
    );
  });
});
