/** pdf.js의 SVG 마스크와 같은 알파를 DOM 없는 worker 캔버스에서 만듭니다. */
export function createPdfMaskCanvas(
  source: OffscreenCanvas,
  luminosity: boolean,
  transferMap?: Uint8Array | null,
): OffscreenCanvas {
  const context = source.getContext('2d');
  if (!context) throw new Error('PDF mask canvas is unavailable.');
  const image = context.getImageData(0, 0, source.width, source.height);
  const pixels = image.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = luminosity
      ? 0.3 * pixels[index] + 0.59 * pixels[index + 1] + 0.11 * pixels[index + 2]
      : pixels[index + 3];
    pixels[index + 3] = transferMap
      ? transferMap[Math.min(255, Math.floor((alpha * 256) / 255))]
      : alpha;
  }
  const canvas = new OffscreenCanvas(source.width, source.height);
  const output = canvas.getContext('2d');
  if (!output) throw new Error('PDF mask canvas is unavailable.');
  output.putImageData(image, 0, 0);
  return canvas;
}
