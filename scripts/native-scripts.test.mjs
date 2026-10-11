import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { copyVerifiedAsset } from './copy-ternlight-assets.mjs';
import { commandInvocation } from './script-process.mjs';
import { rustInvocation } from './rust-process.mjs';
import { checkRelease } from './check-release.mjs';
import { installCargoTool, securityTools } from './install-rust-security-tools.mjs';

describe('네이티브 개발 스크립트', () => {
  it('Rust 검사 도구의 고정 버전과 OpenSSL 빌드 옵션을 유지한다', () => {
    expect(securityTools).toContainEqual(['wasm-bindgen-cli', '0.2.123', 'wasm-bindgen']);
    expect(securityTools).toContainEqual([
      'cargo-geiger',
      '0.13.0',
      'cargo-geiger',
      '--features',
      'vendored-openssl',
    ]);
  });
  it('설치 실패는 세 번 재시도하고 마지막 오류 코드를 유지한다', () => {
    const failure = Object.assign(new Error('설치 실패'), { exitCode: 9 });
    const calls = [],
      waits = [];
    const rust = {
      cargo: (args) => {
        calls.push(args);
        throw failure;
      },
    };
    expect(() => installCargoTool(rust, securityTools[3], (ms) => waits.push(ms))).toThrow(failure);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual([
      'install',
      'cargo-geiger',
      '--version',
      '0.13.0',
      '--locked',
      '--force',
      '--features',
      'vendored-openssl',
    ]);
    expect(waits).toEqual([10_000, 20_000]);
  });
  it('공백과 특수 문자가 있는 npm 인자를 셸 없이 전달한다', () => {
    const args = ['run', 'review', '--', '--tag', 'a & b'];
    expect(
      commandInvocation('npm', args, { platform: 'win32', npmCli: 'C:/Node/npm-cli.js' }),
    ).toEqual({ command: process.execPath, args: ['C:/Node/npm-cli.js', ...args] });
    expect(commandInvocation('git', args, { platform: 'win32' })).toEqual({ command: 'git', args });
  });

  it('Rust 네이티브 실행은 WSL을 호출하지 않고 Linux 도구만 WSL로 보낸다', () => {
    expect(rustInvocation('cargo', ['test'], { useWsl: false, cwd: 'D:/작업 폴더' })).toEqual({
      command: 'cargo',
      args: ['test'],
    });
    expect(
      rustInvocation('cargo', ['test', '--manifest-path', '/mnt/d/작업 폴더/Cargo.toml'], {
        useWsl: true,
        cwd: '/mnt/d/작업 폴더',
        env: { CARGO_NET_OFFLINE: 'true' },
      }),
    ).toEqual({
      command: 'wsl.exe',
      args: [
        '--cd',
        '/mnt/d/작업 폴더',
        '--exec',
        'env',
        'CARGO_NET_OFFLINE=true',
        'cargo',
        'test',
        '--manifest-path',
        '/mnt/d/작업 폴더/Cargo.toml',
      ],
    });
  });

  it('체크섬이 다르면 기존 자산을 보존하고 맞으면 복사한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-check-'));
    try {
      const source = join(root, 'source.wasm'),
        target = join(root, 'target.wasm');
      writeFileSync(source, 'new');
      writeFileSync(target, 'old');
      expect(() => copyVerifiedAsset(source, target, 'invalid')).toThrow('체크섬');
      expect(readFileSync(target, 'utf8')).toBe('old');
      copyVerifiedAsset(source, target, createHash('sha256').update('new').digest('hex'));
      expect(readFileSync(target, 'utf8')).toBe('new');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('릴리스 실패 코드와 순서를 보존하고 후속 단계를 실행하지 않는다', () => {
    const order = ['security:full', 'build', 'review', 'copy:check'];
    for (const failed of [...order, '']) {
      const calls = [];
      const run = (command, args) => {
        calls.push(args[1]);
        if (args[1] === 'review')
          expect(args).toEqual(['run', 'review', '--', '--tag', '1.2.3', '--built']);
        if (args[1] === failed) throw Object.assign(new Error('실패'), { exitCode: 7 });
      };
      if (failed) expect(() => checkRelease('1.2.3', run)).toThrow('실패');
      else checkRelease('1.2.3', run);
      expect(calls).toEqual(failed ? order.slice(0, order.indexOf(failed) + 1) : order);
    }
  });
});
