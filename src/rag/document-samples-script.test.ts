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

/** 텍스트 레이어 없는 1페이지 이미지 PDF(2x2 RGB)를 만듭니다. */
function syntheticScanPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  ];
  const pixels = Buffer.from([255, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0]);
  objects.push(
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels.toString('latin1')}\nendstream`,
  );
  const content = 'q 200 0 0 100 0 0 cm /Im0 Do Q';
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
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

  it('텍스트 레이어가 없는 스캔 PDF는 OCR 보류로 분류하고 실패로 세지 않는다', () => {
    const path = directory();
    writeFileSync(join(path, 'synthetic-scan.pdf'), syntheticScanPdf());
    writeFileSync(join(path, 'synthetic-body.txt'), 'Synthetic body');
    const result = run([path]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      pdf: { checked: 1, passed: 0, reasons: { 'ocr-required': 1 }, deferred: 1 },
      txt: { checked: 1, passed: 1, reasons: {} },
    });
    // 안내는 stderr로만 나가고 표준 출력의 JSON과 파일명은 그대로 유지합니다.
    expect(result.stdout).not.toContain('synthetic-scan');
    expect(result.stderr).toContain('ocr-required');
    expect(result.stderr).toContain('scripts/test-pdf-ocr.mjs');
  });

  it('빈 디렉터리와 누락된 인자는 성공으로 보고하지 않는다', () => {
    expect(run([directory()]).status).toBe(1);
    expect(run([]).status).toBe(1);
  });
});
