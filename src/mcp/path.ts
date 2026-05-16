const SHELL_CANDIDATES = [
  '/opt/homebrew/bin/fish',
  '/usr/local/bin/fish',
  '/usr/bin/fish',
  '/bin/zsh',
  '/bin/bash',
  '/bin/sh',
] as const;

export async function getDesktopLoginShellPath(): Promise<string> {
  const { execFileSync } = await import('node:child_process');

  let shell = typeof process !== 'undefined' ? (process.env.SHELL ?? '') : '';
  if (!shell || !shell.startsWith('/')) {
    shell = '';
  }

  const candidates = shell ? [shell, ...SHELL_CANDIDATES] : SHELL_CANDIDATES;

  for (const candidate of candidates) {
    try {
      const args = candidate.includes('fish') ? ['-lc', 'printenv PATH'] : ['-ilc', 'printenv PATH'];
      const output = execFileSync(candidate, args, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      if (output.includes(':') || output.includes(';')) {
        return output;
      }
    } catch {
      // 실행 가능한 shell 후보만 사용합니다.
    }
  }

  throw new Error('실행 가능한 shell을 찾을 수 없습니다.');
}
