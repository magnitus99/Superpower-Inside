import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { replacePdfMaskFilters } from './pdf-mask-build.mjs';

it('설치된 pdf.js의 마스크 필터만 worker 캔버스 구현으로 연결한다', () => {
  const source = readFileSync(
    new URL('../node_modules/pdfjs-dist/build/pdf.mjs', import.meta.url),
    'utf8',
  );
  const replaced = replacePdfMaskFilters(source, '/synthetic/pdf-mask.ts');
  expect(replaced).toContain(
    'createPdfMaskCanvas(srcEntry.canvas, filterSpec.subtype === "Luminosity", filterSpec.transferMap, pCtx.canvas);',
  );
  expect(replaced).not.toContain(
    'this.filterFactory.addLuminosityFilter(transferMap)',
  );
  expect(replaced).toContain('layerCtx.globalCompositeOperation = "destination-in";');
  expect(() => replacePdfMaskFilters(source.replace('pCtx.filter = "none";', 'changed;'), '/synthetic/pdf-mask.ts')).toThrow();
  expect(() => replacePdfMaskFilters('changed upstream API', '/synthetic/pdf-mask.ts')).toThrow();
});

it('pdf.js의 폰트·본문 처리 번들에는 런타임 코드 평가가 없다', () => {
  for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
    const source = readFileSync(new URL(`../node_modules/pdfjs-dist/build/${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(?:eval|new\s+Function)\s*\(/u);
  }
});
