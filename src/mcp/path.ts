const SHELL_CANDIDATES = [
  '/opt/homebrew/bin/fish',
  '/usr/local/bin/fish',
  '/usr/bin/fish',
  '/bin/zsh',
  '/bin/bash',
  '/bin/sh',
] as const;

export async function getDesktopLoginShellPath(): Promise<string> {
  const [{ execFileSync }, { accessSync, constants: fsConstants }] = await Promise.all([
    import('node:child_process'),
    import('node:fs'),
  ]);

  let shell = typeof process !== 'undefined' ? (process.env.SHELL ?? '') : '';
  if (!shell || !shell.startsWith('/')) {
    shell = '';
    for (const candidate of SHELL_CANDIDATES) {
      try {
        accessSync(candidate, fsConstants.X_OK);
        shell = candidate;
        break;
      } catch {
        // 실행 가능한 shell 후보만 사용합니다.
      }
    }
  }

  if (!shell) {
    throw new Error('실행 가능한 shell을 찾을 수 없습니다.');
  }

  const args = shell.includes('fish') ? ['-lc', 'printenv PATH'] : ['-ilc', 'printenv PATH'];
  const output = execFileSync(shell, args, {
    encoding: 'utf8',
    timeout: 5000,
  }).trim();

  if (!output.includes(':') && !output.includes(';')) {
    throw new Error(`Unexpected PATH output: "${output}"`);
  }

  return output;
}
