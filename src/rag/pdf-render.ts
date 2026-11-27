import { renderAssets } from 'pdf-render-assets';

/** pdf.js의 캔버스 I/O를 worker의 OffscreenCanvas에 연결합니다. */
export class PdfCanvasFactory {
  create(
    width: number,
    height: number,
  ): {
    canvas: OffscreenCanvas;
    context: OffscreenCanvasRenderingContext2D;
  } {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PDF canvas is unavailable.');
    return { canvas, context };
  }

  reset(target: { canvas: OffscreenCanvas }, width: number, height: number): void {
    target.canvas.width = width;
    target.canvas.height = height;
  }

  destroy(target: { canvas: OffscreenCanvas | null; context: unknown }): void {
    if (target.canvas) {
      target.canvas.width = 0;
      target.canvas.height = 0;
    }
    target.canvas = null;
    target.context = null;
  }
}

function asset(name: string): Uint8Array {
  const encoded = renderAssets[name];
  if (!encoded) throw new Error(`PDF render asset is missing: ${name}`);
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

export class PdfBinaryDataFactory {
  fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (kind === 'cMapUrl') return Promise.resolve(asset(`cmaps/${filename}`));
    if (kind === 'standardFontDataUrl') return Promise.resolve(asset(`standard_fonts/${filename}`));
    throw new Error(`Unsupported PDF render asset kind: ${kind}`);
  }
}
