/**
 * src/lib/pdf-extract/page-text.ts
 *
 * Per-widget page snippets: the static page text nearest to each widget, up to
 * 200 characters, sent to the AI as evidence.
 *
 * Privacy rule (requirement 11.1, decision 18): text that may belong to a field
 * value must never enter a snippet. All geometry here is in native PDF user
 * space, the space of both pdf.js text transforms and widget /Rect values, so
 * no coordinate conversion happens. A text item is dropped when:
 * - its transform is not axis-aligned (b or c is not 0) or is mirrored,
 * - its width or height is missing, non-finite or not positive (uncertain bounds),
 * - its box, including descent below the baseline, touches any widget rect on
 *   the page after that rect is expanded by 2pt on every side.
 * Pages that are rotated or whose crop box does not start at (0,0) get no
 * snippets at all (the caller enforces this; see index.ts).
 */

import type { PdfRect } from './pdf-objects.js';

export const MAX_SNIPPET_LENGTH = 200;
/** Widget rects are expanded by this many points before the intersection test. */
export const WIDGET_MARGIN = 2;
/** Descent below the baseline as a fraction of the text height. */
export const DESCENT_RATIO = 0.3;

/** A text item as reported by pdf.js getTextContent(). */
export interface TextItem {
  str: string;
  /** [a, b, c, d, tx, ty] in PDF user space */
  transform: number[];
  width: number;
  height: number;
}

/** Box of an axis-aligned text item including descent, or undefined if uncertain. */
export function textItemBox(item: TextItem): PdfRect | undefined {
  const t = item.transform;
  if (!Array.isArray(t) || t.length !== 6 || !t.every((v) => Number.isFinite(v))) return undefined;
  const [a, b, c, d, tx, ty] = t as [number, number, number, number, number, number];
  if (b !== 0 || c !== 0 || a <= 0 || d <= 0) return undefined;
  const { width, height } = item;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    left: tx,
    right: tx + width,
    bottom: ty - DESCENT_RATIO * height,
    top: ty + height,
  };
}

function expand(r: PdfRect, m: number): PdfRect {
  return { left: r.left - m, bottom: r.bottom - m, right: r.right + m, top: r.top + m };
}

/** Closed-interval overlap: touching edges count as overlapping. */
function touches(a: PdfRect, b: PdfRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.bottom <= b.top && a.top >= b.bottom;
}

function centre(r: PdfRect): [number, number] {
  return [(r.left + r.right) / 2, (r.bottom + r.top) / 2];
}

/**
 * Shortest distance between two rectangles (0 when they overlap). Wide fields
 * have their labels near an edge, far from their centre, so edge distance
 * ranks a field's own label ahead of labels from neighbouring rows.
 */
export function rectDistance(a: PdfRect, b: PdfRect): number {
  const dx = Math.max(0, b.left - a.right, a.left - b.right);
  const dy = Math.max(0, b.bottom - a.top, a.bottom - b.top);
  return Math.hypot(dx, dy);
}

/**
 * Compute one snippet per widget rect. `widgetRects` must contain every widget on
 * the page, since each one excludes the text it touches from all snippets.
 */
export function computePageSnippets(items: TextItem[], widgetRects: PdfRect[]): string[] {
  const guards = widgetRects.map((r) => expand(r, WIDGET_MARGIN));

  const usable: { str: string; box: PdfRect }[] = [];
  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str.trim() : '';
    if (!str) continue;
    const box = textItemBox(item);
    if (!box) continue;
    if (guards.some((g) => touches(box, g))) continue;
    usable.push({ str, box });
  }

  return widgetRects.map((rect) => {
    const [cx, cy] = centre(rect);
    const sorted = usable
      .map((u) => {
        const [x, y] = centre(u.box);
        return { str: u.str, edge: rectDistance(u.box, rect), mid: Math.hypot(x - cx, y - cy) };
      })
      .sort((p, q) => p.edge - q.edge || p.mid - q.mid);

    let snippet = '';
    for (const { str } of sorted) {
      const next = snippet ? `${snippet} ${str}` : str;
      if (next.length <= MAX_SNIPPET_LENGTH) {
        snippet = next;
        continue;
      }
      const room = MAX_SNIPPET_LENGTH - snippet.length - (snippet ? 1 : 0);
      if (room > 3) snippet = snippet ? `${snippet} ${str.slice(0, room)}` : str.slice(0, room);
      break;
    }
    return snippet.slice(0, MAX_SNIPPET_LENGTH);
  });
}
