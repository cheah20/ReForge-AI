/**
 * src/lib/pdf-extract/page-text.ts
 *
 * Per-widget page snippet extraction using pdf.js.
 * For each widget, finds the nearest text items on the same page and
 * concatenates up to 200 characters of context.
 *
 * Per decision 18 / requirement 11.1:
 * Text drawn by form widget annotations (existing field values) must NOT appear
 * in the snippet. We exclude text items whose bounding box intersects the
 * widget's bounding box, so pre-filled values never reach the AI.
 *
 * Uses pdf.js (pdfjs-dist) for text extraction — it runs in Node.js via the
 * legacy build.
 */

import type { Widget } from '../../shared/types.js';

/** A simplified text item from pdf.js */
interface TextItem {
  str: string;
  transform: number[]; // [a, b, c, d, tx, ty]
  width: number;
  height: number;
}

/** Approximate bounding box from a pdf.js text item (PDF-space, bottom-origin) */
function textItemBbox(item: TextItem): {
  left: number;
  bottom: number;
  right: number;
  top: number;
} {
  const tx = item.transform[4] ?? 0;
  const ty = item.transform[5] ?? 0;
  return {
    left: tx,
    bottom: ty,
    right: tx + (item.width ?? 0),
    top: ty + (item.height ?? 0),
  };
}

/** True if two rectangles (bottom-origin PDF space) overlap */
function rectsOverlap(
  a: { left: number; bottom: number; right: number; top: number },
  b: { left: number; bottom: number; right: number; top: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;
}

/** Euclidean distance from a point to the centre of a widget bbox */
function distToCentre(
  tx: number,
  ty: number,
  widget: Widget,
  pageHeight: number,
): number {
  // Widget bbox is top-origin; convert to bottom-origin for comparison with text
  const cx = (widget.bbox.left + widget.bbox.right) / 2;
  const cy = pageHeight - (widget.bbox.top + widget.bbox.bottom) / 2;
  return Math.sqrt((tx - cx) ** 2 + (ty - cy) ** 2);
}

/**
 * Compute page snippets for all widgets on a given page.
 * Returns a map from widget index (within the widgets array) to snippet string.
 *
 * @param textItems - pdf.js text items for the page (bottom-origin PDF space)
 * @param widgets - widgets on this page (top-origin coordinates)
 * @param pageHeight - page height in PDF user units
 * @param widgetBboxesBottomOrigin - precomputed bottom-origin bboxes for each widget
 *   (used to exclude text that intersects a field — privacy rule)
 */
export function computePageSnippets(
  textItems: TextItem[],
  widgets: Widget[],
  pageHeight: number,
  widgetBboxesBottomOrigin: Array<{
    left: number;
    bottom: number;
    right: number;
    top: number;
  }>,
): string[] {
  const snippets = widgets.map(() => '');

  for (let wi = 0; wi < widgets.length; wi++) {
    const widget = widgets[wi];
    const widgetBbox = widgetBboxesBottomOrigin[wi];
    if (!widget || !widgetBbox) continue;

    // Filter: exclude text that overlaps any widget bbox (privacy + accuracy)
    const usableItems = textItems.filter((item) => {
      if (!item.str.trim()) return false;
      const ib = textItemBbox(item);
      // Exclude if this text item intersects any widget bbox on the page
      for (const wb of widgetBboxesBottomOrigin) {
        if (rectsOverlap(ib, wb)) return false;
      }
      return true;
    });

    // Sort by distance from widget centre
    const sorted = usableItems
      .map((item) => ({
        item,
        dist: distToCentre(
          item.transform[4] ?? 0,
          item.transform[5] ?? 0,
          widget,
          pageHeight,
        ),
      }))
      .sort((a, b) => a.dist - b.dist);

    // Concatenate until 200 chars
    let snippet = '';
    for (const { item } of sorted) {
      const word = item.str.trim();
      if (!word) continue;
      const candidate = snippet ? `${snippet} ${word}` : word;
      if (candidate.length <= 200) {
        snippet = candidate;
      } else {
        // Add as much as we can
        const remaining = 200 - snippet.length - 1;
        if (remaining > 3) snippet = `${snippet} ${word.substring(0, remaining)}`;
        break;
      }
    }

    snippets[wi] = snippet.substring(0, 200);
  }

  return snippets;
}

/**
 * Convert a widget's top-origin bbox to bottom-origin PDF space.
 */
export function toBboxBottomOrigin(
  widget: Widget,
  pageHeight: number,
): { left: number; bottom: number; right: number; top: number } {
  return {
    left: widget.bbox.left,
    bottom: pageHeight - widget.bbox.bottom,
    right: widget.bbox.right,
    top: pageHeight - widget.bbox.top,
  };
}
