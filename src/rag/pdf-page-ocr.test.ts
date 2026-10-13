import { expect, it, vi } from 'vitest';
import { PSM } from 'tesseract.js';
import { recognizePdfPage } from './pdf-page-ocr';

it('신뢰도가 충분한 본문은 추가 인식 없이 반환한다', async () => {
  const data = { text: 'Synthetic source text', confidence: 90 };
  const worker = { recognize: vi.fn().mockResolvedValue({ data }), setParameters: vi.fn() };
  await expect(recognizePdfPage(worker, new Blob())).resolves.toEqual(data);
  expect(worker.recognize).toHaveBeenCalledTimes(1);
  expect(worker.setParameters).not.toHaveBeenCalled();
});

it('신뢰도가 낮은 배치는 sparse 방식으로 재시도하고 다음 페이지의 기본 모드를 복구한다', async () => {
  const data = { text: 'Synthetic headings and columns', confidence: 80 };
  const worker = {
    recognize: vi
      .fn()
      .mockResolvedValueOnce({ data: { text: 'uncertain', confidence: 30 } })
      .mockResolvedValueOnce({ data }),
    setParameters: vi.fn().mockResolvedValue(undefined),
  };
  await expect(recognizePdfPage(worker, new Blob())).resolves.toEqual(data);
  expect(worker.setParameters.mock.calls).toEqual([
    [{ tessedit_pageseg_mode: PSM.SPARSE_TEXT }],
    [{ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }],
  ]);
});

it('재시도가 빈 결과거나 여전히 불확실하면 기존 신뢰도 차단을 유지한다', async () => {
  const first = { text: 'uncertain', confidence: 30 };
  const worker = {
    recognize: vi
      .fn()
      .mockResolvedValueOnce({ data: first })
      .mockResolvedValueOnce({ data: { text: '', confidence: 90 } }),
    setParameters: vi.fn().mockResolvedValue(undefined),
  };
  const result = await recognizePdfPage(worker, new Blob());
  expect(result).toEqual(first);
  expect(result.confidence).toBeLessThan(50);
});

it('재시도 중 엔진이 실패해도 다음 페이지의 모드를 복구한다', async () => {
  const worker = {
    recognize: vi
      .fn()
      .mockResolvedValueOnce({ data: { text: '', confidence: 0 } })
      .mockRejectedValueOnce(new Error('engine stopped')),
    setParameters: vi.fn().mockResolvedValue(undefined),
  };
  await expect(recognizePdfPage(worker, new Blob())).rejects.toThrow('engine stopped');
  expect(worker.setParameters).toHaveBeenLastCalledWith({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
  });
});
