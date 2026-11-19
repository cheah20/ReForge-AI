/**
 * src/lib/document/reading-order.ts
 *
 * Line grouping and reading order (formbridge-any-document Requirements 4.2
 * and 4.6). Fragments whose vertical centres lie within half the median
 * fragment height of a row belong to that row; rows run top to bottom and the
 * fragments of a row left to right.
 */

import type { Box } from './types.js';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Returns the fragments in reading order. The input array is not changed. */
export function groupIntoLines<T extends { box: Box }>(fragments: readonly T[]): T[] {
  const tolerance = median(fragments.map((f) => f.box.bottom - f.box.top)) / 2;
  const sorted = [...fragments].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const rows: Array<{ centre: number; items: T[] }> = [];
  for (const f of sorted) {
    const centre = (f.box.top + f.box.bottom) / 2;
    const row = rows.find((r) => Math.abs(r.centre - centre) <= tolerance);
    if (row) {
      row.items.push(f);
      row.centre = row.items.reduce((s, i) => s + (i.box.top + i.box.bottom) / 2, 0) / row.items.length;
    } else {
      rows.push({ centre, items: [f] });
    }
  }
  rows.sort((a, b) => a.centre - b.centre);
  return rows.flatMap((r) => r.items.sort((a, b) => a.box.left - b.box.left));
}
