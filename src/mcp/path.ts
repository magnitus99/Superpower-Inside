import { execFileSync } from 'node:child_process';

const SHELL_CANDIDATES = [
  '/opt/homebrew/bin/fish',
  '/usr/local/bin/fish',
  '/usr/bin/fish',
  '/bin/zsh',
  '/bin/bash',
  '/bin/sh',
] as const;

const WINDOWS_SHELL_CANDIDATES = ['pwsh.exe', 'powershell.exe'] as const;

export interface MCPPathPlatformLike {
  isWin?: boolean;
}

export type MCPPathCommandRunner = (command: string, args: readonly string[]) => string;

export interface GetDesktopLoginShellPathOptions {
  platform?: MCPPathPlatformLike;
  includeWslPath?: boolean;
  runner?: MCPPathCommandRunner;
}

export function getDesktopLoginShellPath(options: GetDesktopLoginShellPathOptions = {}): string {
  const runner = options.runner ?? runPathCommand;
  if (isWindowsPlatform(options.platform)) {
    return getWindowsPath(runner, options.includeWslPath === true);
  }

  return getPosixLoginShellPath(runner);
}

function getPosixLoginShellPath(runner: MCPPathCommandRunner): string {
  let shell = typeof process !== 'undefined' ? (process.env.SHELL ?? '') : '';
  if (!shell || !shell.startsWith('/')) {
    shell = '';
  }

  const candidates = shell ? [shell, ...SHELL_CANDIDATES] : SHELL_CANDIDATES;

  for (const candidate of candidates) {
    try {
      const args = candidate.includes('fish') ? ['-lc', 'printenv PATH'] : ['-ilc', 'printenv PATH'];
      const output = runner(candidate, args).trim();

      if (isPathOutput(output)) {
        return output;
      }
    } catch {
      // 실행 가능한 shell 후보만 사용합니다.
    }
  }

  throw new Error('실행 가능한 shell을 찾을 수 없습니다.');
}

function getWindowsPath(runner: MCPPathCommandRunner, includeWslPath: boolean): string {
  let windowsPath = '';

  for (const candidate of WINDOWS_SHELL_CANDIDATES) {
    try {
      const output = runner(candidate, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$env:Path',
      ]).trim();

      if (isPathOutput(output)) {
        windowsPath = output;
        break;
      }
    } catch {
      // 설치된 PowerShell 후보만 사용합니다.
    }
  }

  if (!windowsPath) {
    throw new Error('PowerShell에서 PATH를 가져올 수 없습니다.');
  }

  if (!includeWslPath) {
    return windowsPath;
  }

  try {
    const wslPath = runner('wsl.exe', ['-e', 'sh', '-lc', 'printf %s "$PATH"']).trim();
    if (isPathOutput(wslPath)) {
      return `${windowsPath};${wslPath}`;
    }
  } catch {
    // WSL PATH 조회 실패는 Windows PATH 사용을 막지 않습니다.
  }

  return windowsPath;
}

function isWindowsPlatform(platform: MCPPathPlatformLike | undefined): boolean {
  if (typeof platform?.isWin === 'boolean') {
    return platform.isWin;
  }

  return typeof process !== 'undefined' && process.platform === 'win32';
}

function isPathOutput(output: string): boolean {
  return output.includes(':') || output.includes(';');
}

function runPathCommand(command: string, args: readonly string[]): string {
  return execFileSync(command, [...args], {
    encoding: 'utf8',
    timeout: 5000,
  });
}
