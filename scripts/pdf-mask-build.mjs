import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// pdf.js 6에서 backdrop 합성 뒤의 DOM 필터만 교체합니다. 입력 코드가 바뀌면
// 검토 없이 교체 범위를 넓히지 않도록 해당 필터 블록의 내용까지 검사합니다.
const domFilter = 'url: subtype === "Alpha" ? this.filterFactory.addAlphaFilter(transferMap) : this.filterFactory.addLuminosityFilter(transferMap),';
const start = '    pCtx.filter = filterSpec.url;';
const end = '    this.canvasFactory.destroy(srcEntry);';
const filterHash = '1b85862f32cfdababd83f968201b1cd8e875194396cae43e1d1e7a172fb9aa89';

export function replacePdfMaskFilters(source, maskModule) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0 || source.indexOf(start, from + 1) !== -1 ||
      source.split(domFilter).length !== 2 ||
      createHash('sha256').update(source.slice(from, to)).digest('hex') !== filterHash) {
    throw new Error('pdf.js mask rendering contract changed. Review the worker adapter.');
  }
  const maskPass = '    createPdfMaskCanvas(srcEntry.canvas, filterSpec.subtype === "Luminosity", filterSpec.transferMap, pCtx.canvas);\n';
  return `import { createPdfMaskCanvas } from ${JSON.stringify(maskModule)};\n` + (source.slice(0, from) + maskPass + source.slice(to)).replace(domFilter, '');
}

export function pdfMaskBuildPlugin(maskModule) {
  return {
    name: 'pdf-worker-mask',
    setup(builder) {
      builder.onLoad({ filter: /pdfjs-dist[/\\]build[/\\]pdf\.mjs$/ }, async ({ path }) => ({
        contents: replacePdfMaskFilters(await readFile(path, 'utf8'), maskModule),
        loader: 'js',
      }));
    },
  };
}
