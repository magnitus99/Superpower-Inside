export interface RuntimeVectorInput {
  id: string;
  vector: readonly number[];
}

export interface RuntimeVectorPage {
  offset: number;
  rowCount: number;
  dimension: number;
  entryIds: string[];
  values: Float32Array;
}

export interface RuntimeVectorPageOptions {
  pageSize: number;
}

export function createPagedVectorMatrix(
  entries: readonly RuntimeVectorInput[],
  options: RuntimeVectorPageOptions,
): RuntimeVectorPage[] {
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const dimension = entries[0]?.vector.length ?? 0;
  if (dimension === 0 || entries.length === 0) return [];

  const pages: RuntimeVectorPage[] = [];
  for (let offset = 0; offset < entries.length; offset += pageSize) {
    const slice = entries.slice(offset, offset + pageSize);
    const values = new Float32Array(slice.length * dimension);
    const entryIds: string[] = [];
    for (let rowIndex = 0; rowIndex < slice.length; rowIndex++) {
      const entry = slice[rowIndex];
      if (!entry || entry.vector.length !== dimension) continue;
      entryIds.push(entry.id);
      values.set(entry.vector, rowIndex * dimension);
    }
    pages.push({
      offset,
      rowCount: entryIds.length,
      dimension,
      entryIds,
      values,
    });
  }
  return pages;
}

export function estimateRuntimePayloadBytes(page: RuntimeVectorPage): number {
  return page.values.byteLength;
}

export function enforceRuntimePayloadBudget(
  page: RuntimeVectorPage,
  maxPayloadBytes: number,
): void {
  const payloadBytes = estimateRuntimePayloadBytes(page);
  if (payloadBytes > maxPayloadBytes) {
    throw new Error(
      `RAG runtime payload ${payloadBytes} bytes exceeds budget ${maxPayloadBytes} bytes`,
    );
  }
}
