/**
 * src/lib/pdf-fill/overflow.ts
 *
 * Text fitting for field appearances (requirement 10.2): choose a font size
 * that fits every widget of the field, or fail. Nothing is ever cut off.
 *
 * - Single line: shrink from the field's own size to MIN_FONT_SIZE in 0.5pt
 *   steps until the text width fits the inner width.
 * - Multiline: break at spaces and explicit newlines into lines no wider than
 *   the inner width (the same word breaking pdf-lib uses when it draws), and
 *   require lines * line height to fit the inner height. A single word wider
 *   than a line cannot be broken, so it overflows.
 * Inner size = widget size minus PADDING on every side.
 */

/** Smallest readable font size in points. */
export const MIN_FONT_SIZE = 8;
/** Space kept free inside a widget on every side, in points. */
export const PADDING = 3;
const STEP = 0.5;

export class TextOverflowError extends Error {
  constructor(
    readonly fieldId: string,
    readonly multiline: boolean,
  ) {
    super(`Text does not fit field "${fieldId}" at ${MIN_FONT_SIZE}pt`);
    this.name = 'TextOverflowError';
  }
}

/** The part of a font needed to measure text. */
export interface Metrics {
  widthOfTextAtSize(text: string, size: number): number;
  heightAtSize(size: number): number;
}

export interface Box {
  width: number;
  height: number;
}

export interface Fit {
  size: number;
  lines: string[];
}

/** Break `text` into lines no wider than `maxWidth`, or undefined if a word is too wide. */
export function wrapLines(metrics: Metrics, text: string, size: number, maxWidth: number): string[] | undefined {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      if (metrics.widthOfTextAtSize(word, size) > maxWidth) return undefined;
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && metrics.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Fit `text` into one box at exactly `size`, or undefined. */
export function fitAtSize(metrics: Metrics, text: string, box: Box, size: number, multiline: boolean): string[] | undefined {
  const innerWidth = box.width - 2 * PADDING;
  const innerHeight = box.height - 2 * PADDING;
  if (innerWidth <= 0 || innerHeight <= 0) return undefined;

  if (!multiline) {
    if (text.includes('\n') || text.includes('\r')) return undefined;
    return metrics.widthOfTextAtSize(text, size) <= innerWidth && metrics.heightAtSize(size) <= innerHeight ? [text] : undefined;
  }
  const lines = wrapLines(metrics, text, size, innerWidth);
  if (!lines) return undefined;
  return lines.length * metrics.heightAtSize(size) <= innerHeight ? lines : undefined;
}

/**
 * The largest size from `startSize` down to MIN_FONT_SIZE at which `text` fits
 * every box, with the lines for the first box. Throws TextOverflowError if even
 * MIN_FONT_SIZE does not fit.
 */
export function fitText(
  metrics: Metrics,
  fieldId: string,
  text: string,
  boxes: readonly Box[],
  startSize: number,
  multiline: boolean,
): Fit {
  for (const size of candidateSizes(startSize)) {
    const all = boxes.map((b) => fitAtSize(metrics, text, b, size, multiline));
    if (boxes.length > 0 && all.every((lines) => lines !== undefined)) return { size, lines: all[0]! };
  }
  throw new TextOverflowError(fieldId, multiline);
}

/** startSize, then 0.5pt smaller each step, always ending with exactly MIN_FONT_SIZE. */
export function candidateSizes(startSize: number): number[] {
  const start = Number.isFinite(startSize) ? Math.max(MIN_FONT_SIZE, startSize) : MIN_FONT_SIZE;
  const sizes: number[] = [];
  for (let size = start; size > MIN_FONT_SIZE; size -= STEP) sizes.push(size);
  sizes.push(MIN_FONT_SIZE);
  return sizes;
}
