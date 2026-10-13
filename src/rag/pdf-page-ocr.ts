import { PSM } from 'tesseract.js';

interface PageRecognition {
  text: string;
  confidence: number;
}
interface PageOcrWorker {
  recognize(image: Blob): Promise<{ data: PageRecognition }>;
  setParameters(parameters: { tessedit_pageseg_mode: PSM }): Promise<unknown>;
}

/** 복잡한 배치는 한 번 더 인식하며 최종 신뢰도 게이트는 호출부에서 유지합니다. */
export async function recognizePdfPage(
  worker: PageOcrWorker,
  image: Blob,
): Promise<PageRecognition> {
  const { data } = await worker.recognize(image);
  if (data.text.trim() && Number.isFinite(data.confidence) && data.confidence >= 50) return data;
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const { data: retried } = await worker.recognize(image);
    return retried.text.trim() &&
      Number.isFinite(retried.confidence) &&
      (!data.text.trim() ||
        !Number.isFinite(data.confidence) ||
        retried.confidence > data.confidence)
      ? retried
      : data;
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  }
}
