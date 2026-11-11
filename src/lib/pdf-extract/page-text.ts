/**
 * src/lib/pdf-extract/page-text.ts
 *
 * Per-widget page snippets: static page text near each widget, up to 200
 * characters, sent to the AI as evidence.
 *
 * Privacy rule (requirement 11.1, decision 18): text that may belong to a field
 * value must never enter a snippet. All geometry is in native PDF user space,
 * the space of both pdf.js text transforms and widget /Rect values. A text item
 * is dropped when:
 * - its transform is not axis-aligned (b or c is not 0) or is mirrored,
 * - its width or height is missing, non-finite or not positive (uncertain bounds),
 * - its box, including descent below the baseline, touches any guard rectangle
 *   expanded by 2pt. Guards are every widget annotation on the page (see
 *   index.ts), not only the widgets that get snippets.
 * Pages that are rotated, whose crop box does not start at (0,0), or whose
 * widgets cannot all be located get no snippets at all (index.ts).
 *
 * Ranking (review 2, item 4): the widget's own label comes first, meaning text
 * directly left of or above the widget within 40pt (or right of it, for
 * checkbox-sized widgets, whose labels sit to the right). Other text follows by
 * edge distance, then centre distance. The snippet stops when it reaches the
 * own label of another widget, so it does not run into the next field's label.
 */

import type { PdfRect } from './pdf-objects.js';

export const MAX_SNIPPET_LENGTH = 200;
/** Guard rectangles are expanded by this many points before the intersection test. */
export const WIDGET_MARGIN = 2;
/** Descent below the baseline as a fraction of the text height. */
export const DESCENT_RATIO = 0.3;
/** Maximum gap between a widget and its own label. */
export const LABEL_GAP = 40;
/** Widgets this wide or narrower (checkboxes, radio buttons) also take a label on their right. */
export const SMALL_WIDGET = 30;

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

export function isFiniteRect(r: PdfRect): boolean {
  return [r.left, r.bottom, r.right, r.top].every((v) => Number.isFinite(v)) && r.left <= r.right && r.bottom <= r.top;
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

const overlapsVertically = (a: PdfRect, b: PdfRect) => a.bottom < b.top && a.top > b.bottom;
const overlapsHorizontally = (a: PdfRect, b: PdfRect) => a.left < b.right && a.right > b.left;

/** True when `box` sits directly left of, above, or (for small widgets) right of `widget`. */
export function isOwnLabelPosition(box: PdfRect, widget: PdfRect): boolean {
  const left = overlapsVertically(box, widget) && box.right <= widget.left && widget.left - box.right <= LABEL_GAP;
  const above = overlapsHorizontally(box, widget) && box.bottom >= widget.top && box.bottom - widget.top <= LABEL_GAP;
  const small = widget.right - widget.left <= SMALL_WIDGET;
  const right = small && overlapsVertically(box, widget) && box.left >= widget.right && box.left - widget.right <= LABEL_GAP;
  return left || above || right;
}

interface Usable {
  index: number;
  str: string;
  box: PdfRect;
}

/** Index of the nearest own-label item of `widget`, or -1. */
function primaryLabel(usable: Usable[], widget: PdfRect): number {
  let best = -1;
  let bestDist = Infinity;
  for (const u of usable) {
    if (!isOwnLabelPosition(u.box, widget)) continue;
    const d = rectDistance(u.box, widget);
    if (d < bestDist) {
      bestDist = d;
      best = u.index;
    }
  }
  return best;
}

/**
 * Compute one snippet per entry of `widgetRects`.
 * @param guardRects every widget annotation on the page (defaults to widgetRects);
 *   text touching any of them is excluded from all snippets.
 */
/** Text items that may be used at all: trimmed, with certain bounds, touching no guard. */
function usableItems(items: TextItem[], widgetRects: PdfRect[], guardRects: PdfRect[]): Usable[] {
  const guards = [...guardRects, ...widgetRects].map((r) => expand(r, WIDGET_MARGIN));
  const usable: Usable[] = [];
  items.forEach((item, index) => {
    const str = typeof item.str === 'string' ? item.str.trim() : '';
    if (!str) return;
    const box = textItemBox(item);
    if (!box) return;
    if (guards.some((g) => touches(box, g))) return;
    usable.push({ index, str, box });
  });
  return usable;
}

/**
 * The printed label of each small widget (radio button or checkbox): the
 * nearest usable text item directly to its right, on the same line, within
 * LABEL_GAP. Undefined for wider widgets and when no such text exists. The
 * same privacy filter as the snippets applies, so field values never qualify.
 */
export function computeOptionLabels(
  items: TextItem[],
  widgetRects: PdfRect[],
  guardRects: PdfRect[] = widgetRects,
): Array<string | undefined> {
  const usable = usableItems(items, widgetRects, guardRects);
  return widgetRects.map((w) => {
    if (w.right - w.left > SMALL_WIDGET) return undefined;
    let best: Usable | undefined;
    for (const u of usable) {
      const gap = u.box.left - w.right;
      if (!overlapsVertically(u.box, w) || gap < 0 || gap > LABEL_GAP) continue;
      if (!best || gap < best.box.left - w.right) best = u;
    }
    return best?.str.slice(0, MAX_SNIPPET_LENGTH);
  });
}

export function computePageSnippets(
  items: TextItem[],
  widgetRects: PdfRect[],
  guardRects: PdfRect[] = widgetRects,
): string[] {
  const usable = usableItems(items, widgetRects, guardRects);

  // The primary (nearest own) label of every widget on the page.
  const allWidgets = [...guardRects, ...widgetRects];
  const primaries = new Set(allWidgets.map((w) => primaryLabel(usable, w)).filter((i) => i >= 0));

  return widgetRects.map((rect) => {
    const [cx, cy] = centre(rect);
    const ranked = usable
      .map((u) => {
        const [x, y] = centre(u.box);
        return {
          u,
          own: isOwnLabelPosition(u.box, rect),
          edge: rectDistance(u.box, rect),
          mid: Math.hypot(x - cx, y - cy),
        };
      })
      .sort((p, q) => Number(q.own) - Number(p.own) || p.edge - q.edge || p.mid - q.mid);

    let snippet = '';
    for (const { u, own } of ranked) {
      // Stop at another widget's own label, unless it is also a label of this widget.
      if (!own && primaries.has(u.index)) break;
      const next = snippet ? `${snippet} ${u.str}` : u.str;
      if (next.length <= MAX_SNIPPET_LENGTH) {
        snippet = next;
        continue;
      }
      const room = MAX_SNIPPET_LENGTH - snippet.length - (snippet ? 1 : 0);
      if (room > 3) snippet = snippet ? `${snippet} ${u.str.slice(0, room)}` : u.str.slice(0, room);
      break;
    }
    return snippet.slice(0, MAX_SNIPPET_LENGTH);
  });
}
