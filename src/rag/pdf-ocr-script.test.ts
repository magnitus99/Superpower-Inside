import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const script = new URL('../../scripts/test-pdf-ocr.mjs', import.meta.url);

afterEach(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'pdf-ocr-script-'));
  directories.push(path);
  return path;
}

function run(args: string[]) {
  return spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
}

describe('PDF OCR 런타임 검사 명령', () => {
  it('인자나 PDF 예시 파일이 없으면 성공으로 보고하지 않는다', () => {
    expect(run([]).status).toBe(1);
    expect(run([join(directory(), 'missing')]).status).toBe(1);
    // PDF가 아닌 파일만 있으면 검사 대상이 없으므로 실패로 끝납니다.
    const empty = directory();
    writeFileSync(join(empty, 'notes.txt'), 'Synthetic body');
    expect(run([empty]).status).toBe(1);
  });
});
