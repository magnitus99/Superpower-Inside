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
    'maskCanvas = createPdfMaskCanvas(maskCanvas, subtype === "Luminosity", transferMap);',
  );
  expect(replaced).not.toContain(
    'layerCtx.filter = this.filterFactory.addLuminosityFilter(transferMap);',
  );
  expect(replaced).toContain('layerCtx.globalCompositeOperation = "destination-in";');
  expect(() => replacePdfMaskFilters('changed upstream API', '/synthetic/pdf-mask.ts')).toThrow();
});
