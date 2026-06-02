export function assertValidEmbeddingBatch(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
  context = 'Embedding batch',
  expectedDimension?: number,
): number {
  if (vectors.length !== expectedCount) {
    throw new Error(
      `${context} result count mismatch: expected ${expectedCount}, got ${vectors.length}`,
    );
  }

  let dimension = expectedDimension;
  for (let index = 0; index < vectors.length; index++) {
    const vector = vectors[index];
    if (
      !Array.isArray(vector) ||
      vector.length === 0 ||
      !vector.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new Error(`${context} contains Invalid embedding vector at index ${index}`);
    }
    dimension ??= vector.length;
    if (vector.length !== dimension) {
      throw new Error(
        `${context} vector dimension mismatch at index ${index}: expected ${dimension}, got ${vector.length}`,
      );
    }
  }

  return dimension ?? 0;
}
