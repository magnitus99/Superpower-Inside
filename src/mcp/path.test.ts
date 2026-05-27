import { describe, expect, it, vi } from 'vitest';
import { getDesktopLoginShellPath, type MCPPathCommandRunner } from './path';

describe('getDesktopLoginShellPath', () => {
  it('Windows에서는 PowerShell 후보를 순서대로 시도한다', () => {
    const runner = vi.fn<MCPPathCommandRunner>((command) => {
      if (command === 'pwsh.exe') {
        throw new Error('pwsh 없음');
      }
      return 'C:\\Windows;C:\\Program Files\\nodejs';
    });

    const path = getDesktopLoginShellPath({
      platform: { isWin: true },
      runner,
    });

    expect(path).toBe('C:\\Windows;C:\\Program Files\\nodejs');
    expect(runner).toHaveBeenNthCalledWith(1, 'pwsh.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$env:Path',
    ]);
    expect(runner).toHaveBeenNthCalledWith(2, 'powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$env:Path',
    ]);
  });

  it('WSL 옵션이 꺼져 있으면 wsl.exe를 호출하지 않는다', () => {
    const runner = vi.fn<MCPPathCommandRunner>(() => 'C:\\Windows;C:\\Tools');

    const path = getDesktopLoginShellPath({
      platform: { isWin: true },
      includeWslPath: false,
      runner,
    });

    expect(path).toBe('C:\\Windows;C:\\Tools');
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).not.toHaveBeenCalledWith('wsl.exe', expect.any(Array));
  });

  it('WSL 옵션이 켜져 있고 WSL 조회가 성공하면 PATH 뒤에 붙인다', () => {
    const runner = vi.fn<MCPPathCommandRunner>((command) => {
      if (command === 'wsl.exe') {
        return '/usr/local/bin:/usr/bin:/bin';
      }
      return 'C:\\Windows;C:\\Tools';
    });

    const path = getDesktopLoginShellPath({
      platform: { isWin: true },
      includeWslPath: true,
      runner,
    });

    expect(path).toBe('C:\\Windows;C:\\Tools;/usr/local/bin:/usr/bin:/bin');
    expect(runner).toHaveBeenCalledWith('wsl.exe', ['-e', 'sh', '-lc', 'printf %s "$PATH"']);
  });

  it('WSL 옵션이 켜져 있어도 WSL 조회 실패는 Windows PATH를 실패시키지 않는다', () => {
    const runner = vi.fn<MCPPathCommandRunner>((command) => {
      if (command === 'wsl.exe') {
        throw new Error('WSL 없음');
      }
      return 'C:\\Windows;C:\\Tools';
    });

    const path = getDesktopLoginShellPath({
      platform: { isWin: true },
      includeWslPath: true,
      runner,
    });

    expect(path).toBe('C:\\Windows;C:\\Tools');
  });

  it('모든 Windows 후보가 실패하면 명확한 오류를 던진다', () => {
    const runner = vi.fn<MCPPathCommandRunner>(() => {
      throw new Error('shell 없음');
    });

    expect(() =>
      getDesktopLoginShellPath({
        platform: { isWin: true },
        runner,
      }),
    ).toThrow('PowerShell에서 PATH를 가져올 수 없습니다.');
  });
});
