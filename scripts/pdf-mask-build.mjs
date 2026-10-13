import { readFile } from 'node:fs/promises';

// pdf.js 5.4의 공개 FilterFactory는 DOM SVG를 요구하므로 마스크 합성 호출만 연결합니다.
const maskFilters = `    if (subtype === "Alpha" && transferMap) {
      layerCtx.filter = this.filterFactory.addAlphaFilter(transferMap);
    } else if (subtype === "Luminosity") {
      layerCtx.filter = this.filterFactory.addLuminosityFilter(transferMap);
    }`;

export function replacePdfMaskFilters(source, maskModule) {
  if (source.split(maskFilters).length !== 2)
    throw new Error('pdf.js mask rendering contract changed. Review the worker adapter.');
  return (
    `import { createPdfMaskCanvas } from ${JSON.stringify(maskModule)};\n` +
    source.replace(
      maskFilters,
      `    if ((subtype === "Alpha" && transferMap) || subtype === "Luminosity") {
      maskCanvas = createPdfMaskCanvas(maskCanvas, subtype === "Luminosity", transferMap);
    }`,
    )
  );
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
