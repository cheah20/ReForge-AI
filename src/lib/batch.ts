/**
 * src/lib/batch.ts
 *
 * Pure batching helper used by the analysis orchestration (design: 30 fields
 * per batch).
 */

export const BATCH_SIZE = 30;

/** Split items into consecutive batches of at most `size` items. */
export function batchFields<T>(fields: readonly T[], size: number = BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('Batch size must be a positive integer');
  }
  const batches: T[][] = [];
  for (let i = 0; i < fields.length; i += size) {
    batches.push(fields.slice(i, i + size));
  }
  return batches;
}
