/**
 * src/lib/document/next-line-values.ts
 *
 * The line directly below a question is usually the answer someone already
 * wrote (a name in a box, a sentence on a fill-in line). It has no digits, no
 * email and no colon, so the text rules cannot see it; its position gives it
 * away. Such a line is treated as value-like and is never offered in the
 * Label_Review (fail closed: a few real labels can be lost, and a prefilled
 * value is not offered). Pure.
 *
 * A line is a next-line value when all of these hold:
 *  - the line above it in reading order is prompt-shaped (ends with a label
 *    colon or a fill-in line),
 *  - it sits directly below that line (its top is within 1.5 line heights of
 *    the bottom of the line above),
 *  - it is not prompt-shaped itself and has no colon,
 *  - it has at most MAX_WORDS words (a longer block is an instruction, not an answer).
 */

import { isPromptShaped } from './review-order.js';
import type { Page } from './types.js';

export const NEXT_LINE_MAX_WORDS = 8;
const MAX_GAP_IN_LINE_HEIGHTS = 1.5;

const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

/** Line indexes of `page` that count as next-line values. */
export function nextLineValues(page: Page): Set<number> {
  const out = new Set<number>();
  const lines = page.lines;
  for (let i = 1; i < lines.length; i++) {
    const above = lines[i - 1]!;
    const line = lines[i]!;
    if (!isPromptShaped(above.text)) continue;
    if (isPromptShaped(line.text) || /[:：]/u.test(line.text)) continue;
    if (wordCount(line.text) > NEXT_LINE_MAX_WORDS) continue;
    const height = Math.max(1, above.box.bottom - above.box.top);
    const gap = line.box.top - above.box.bottom;
    if (gap > height * MAX_GAP_IN_LINE_HEIGHTS) continue;
    out.add(line.index);
  }
  return out;
}
