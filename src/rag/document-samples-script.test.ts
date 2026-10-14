import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const script = new URL('../../scripts/test-document-samples.mjs', import.meta.url);

afterEach(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'document-samples-'));
  directories.push(path);
  return path;
}

function run(args: string[]) {
  return spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
}

describe('로컬 문서 예시 검사 명령', () => {
  it('본문과 파일명을 출력하지 않고 텍스트 추출·청킹 성공을 집계한다', () => {
    const path = directory();
    writeFileSync(join(path, 'private-name.txt'), 'Synthetic confidential body 42');
    const result = run([path]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ txt: { checked: 1, passed: 1, reasons: {} } });
    expect(result.stdout).not.toContain('private-name');
    expect(result.stdout).not.toContain('confidential');
  });

  it('손상된 문서가 있어도 다른 문서를 검사하고 실패 종료 상태를 반환한다', () => {
    const path = directory();
    writeFileSync(join(path, 'broken.xlsx'), 'not-a-zip');
    writeFileSync(join(path, 'valid.txt'), 'Synthetic body');
    const result = run([path]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      xlsx: { checked: 1, passed: 0, reasons: { corrupt: 1 } },
      txt: { checked: 1, passed: 1, reasons: {} },
    });
    expect(result.stdout).not.toContain('broken.xlsx');
  });

  it('빈 디렉터리와 누락된 인자는 성공으로 보고하지 않는다', () => {
    expect(run([directory()]).status).toBe(1);
    expect(run([]).status).toBe(1);
  });
});
