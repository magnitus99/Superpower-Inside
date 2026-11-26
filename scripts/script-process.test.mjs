import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const helper = new URL('./script-process.mjs', import.meta.url).href;
const scratch = fileURLToPath(new URL('../.thinkrail/context/_script-process/', import.meta.url));
const execute = (source, env) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { capture, hasCommand, npm, run } from ${JSON.stringify(helper)};
  ${source}
`], { encoding: 'utf8', env });

describe('개발 스크립트의 네이티브 프로세스 실행', () => {
  it('공백·한글 cwd와 셸 문자가 있는 인자를 그대로 전달한다', () => {
    mkdirSync(scratch, { recursive: true });
    const cwd = mkdtempSync(join(scratch, '한글 경로 '));
    try {
      const result = execute(`console.log(capture(process.execPath,
        ['-e', 'console.log(JSON.stringify([process.cwd(), ...process.argv.slice(1)]))', '--', '한글 & %PATH%'],
        { cwd: ${JSON.stringify(cwd)} }));`);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([cwd, '한글 & %PATH%']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('실패한 자식의 종료 코드와 없는 명령 진단을 보존한다', () => {
    expect(execute(`run(process.execPath, ['-e', 'process.exit(37)']);`).status).toBe(37);
    const result = execute(`
      if (hasCommand('superpower-absent-81829')) process.exit(3);
      run('superpower-absent-81829');
    `);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('superpower-absent-81829');
  });

  it('npm lifecycle의 Node CLI에 인자 배열을 전달한다', () => {
    mkdirSync(scratch, { recursive: true });
    const cwd = mkdtempSync(join(scratch, 'npm fixture '));
    try {
      const cli = join(cwd, '한글 cli.cjs');
      writeFileSync(cli, 'console.log(process.argv[2]); process.exit(27);');
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath'));
      const result = execute(`npm(['한글 & %PATH%']);`, { ...env, npm_execpath: cli });
      expect(result.status, result.stderr).toBe(27);
      expect(result.stdout.trim()).toBe('한글 & %PATH%');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
