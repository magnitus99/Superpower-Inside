import { afterEach, expect, it, vi } from 'vitest';
import { createPdfMaskCanvas } from './pdf-mask';

afterEach(() => vi.unstubAllGlobals());

it('DOM 없이 밝기 마스크를 알파로 변환하며 원본 픽셀을 보존한다', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const original = pixels.slice();
  const image = { data: pixels.slice() };
  const putImageData = vi.fn();
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return { putImageData };
      }
    },
  );
  const source = {
    width: 3,
    height: 1,
    getContext: () => ({ getImageData: () => image }),
  } as unknown as OffscreenCanvas;
  createPdfMaskCanvas(source, true);
  expect(image.data).toEqual(new Uint8ClampedArray([255, 0, 0, 76, 0, 255, 0, 150, 0, 0, 255, 28]));
  expect(pixels).toEqual(original);
  expect(putImageData).toHaveBeenCalledWith(image, 0, 0);
});

it('밝기·알파 마스크의 전달 표를 SVG discrete 필터와 같은 구간에 적용한다', () => {
  const image = { data: new Uint8ClampedArray([128, 128, 128, 64]) };
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return { putImageData: vi.fn() };
      }
    },
  );
  const source = {
    width: 1,
    height: 1,
    getContext: () => ({ getImageData: () => image }),
  } as unknown as OffscreenCanvas;
  const map = Uint8Array.from({ length: 256 }, (_, index) => 255 - index);
  createPdfMaskCanvas(source, true, map);
  expect(image.data[3]).toBe(127);
  image.data[3] = 64;
  createPdfMaskCanvas(source, false, map);
  expect(image.data[3]).toBe(191);
});
