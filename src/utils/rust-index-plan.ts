export interface RustIndexSelectionOptions {
  dedupe?: boolean;
}

const DEFAULT_DEDUPE = true;

export function normalizeRustIndices(
  indices: readonly number[] | undefined,
  recordCount: number,
  options: RustIndexSelectionOptions = {},
): number[] {
  const normalized: number[] = [];
  if (!Number.isInteger(recordCount) || recordCount <= 0 || indices === undefined) {
    return normalized;
  }

  const maxIndex = recordCount;
  const dedupe = options.dedupe ?? DEFAULT_DEDUPE;
  const seen = dedupe ? new Set<number>() : undefined;

  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= maxIndex) {
      continue;
    }
    if (dedupe) {
      if (seen?.has(index)) {
        continue;
      }
      seen?.add(index);
    }
    normalized.push(index);
  }

  return normalized;
}

export function selectByRustIndices<T>(
  records: readonly T[],
  indices: readonly number[] | undefined,
  options: RustIndexSelectionOptions = {},
): T[] {
  const normalized = normalizeRustIndices(indices, records.length, options);
  const selected: T[] = [];

  for (const index of normalized) {
    const record = records[index];
    if (record !== undefined) {
      selected.push(record);
    }
  }

  return selected;
}
