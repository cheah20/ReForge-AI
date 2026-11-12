/**
 * tests/e2e/pdf-check.ts
 *
 * Task 36.2: check the downloaded PDF the way a reader sees it.
 * - Text boxes: each text widget's appearance stream is drawn onto the page
 *   at its rectangle, then pdf.js extracts the text with positions.
 *   Every filled text value must be drawn, and its box must lie inside its
 *   field's widget rectangle. This checks the drawn appearance, not only /V.
 * - Screenshots: pdf.js renders each page of the filled PDF in the browser,
 *   with form appearances, to a canvas that the test screenshots.
 */

import { expect, type Page } from '@playwright/test';
import {
  concatTransformationMatrix,
  drawObject,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFTextField,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib';

interface Rect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

interface DrawnText {
  str: string;
  box: Rect;
}

/** Widget rectangles by field name, page 1, native PDF space. */
function widgetRects(doc: PDFDocument): Map<string, Rect[]> {
  const out = new Map<string, Rect[]>();
  for (const field of doc.getForm().getFields()) {
    const rects = field.acroField.getWidgets().map((w) => {
      const r = w.getRectangle();
      return { left: r.x, bottom: r.y, right: r.x + r.width, top: r.y + r.height };
    });
    out.set(field.getName(), rects);
  }
  return out;
}

/** Text drawn on page 1 after flattening, with each item's box (baseline to text height). */
async function drawnText(bytes: Uint8Array): Promise<DrawnText[]> {
  // A small flatten of our own: pdf-lib's flatten and removeField throw on widgets
  // with no appearance (the empty signature, unfilled fields). Each text widget's
  // normal appearance stream is drawn onto the page at its rectangle; widgets
  // without one draw nothing, so a value expected there fails the "is drawn" check.
  const flat = await PDFDocument.load(bytes);
  const target = flat.getPage(0);
  let n = 0;
  for (const field of flat.getForm().getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    for (const w of field.acroField.getWidgets()) {
      const ap = w.dict.lookup(PDFName.of('AP'));
      const normal = ap instanceof PDFDict ? ap.get(PDFName.of('N')) : undefined;
      if (!(normal instanceof PDFRef)) continue;
      const r = w.getRectangle();
      const name = target.node.newXObject(`FlatAp${n++}`, normal);
      target.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, r.x, r.y), drawObject(name), popGraphicsState());
    }
  }
  target.node.delete(PDFName.of('Annots'));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: await flat.save(), useSystemFonts: true });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items: DrawnText[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [, , , , x, y] = item.transform as number[];
    items.push({ str: item.str, box: { left: x!, bottom: y!, right: x! + item.width, top: y! + item.height } });
  }
  await task.destroy();
  return items;
}

/**
 * Horizontal padding every filled value must keep from its field's left and right
 * edges (fill PADDING, fixture spec: ink within the field allowing 3pt internal
 * padding). Vertically the item box from pdf.js includes the font's full ascent, so
 * only "inside the field" is required there.
 */
export const REQUIRED_PADDING = 3;
const EPSILON = 0.05;

const inside = (inner: Rect, outer: Rect) =>
  inner.left >= outer.left + REQUIRED_PADDING - EPSILON &&
  inner.right <= outer.right - REQUIRED_PADDING + EPSILON &&
  inner.bottom >= outer.bottom - EPSILON &&
  inner.top <= outer.top + EPSILON;

/**
 * For each field, the value (or each line of a multi-line value) must be drawn
 * inside that field's rectangle. Returns the boxes it matched, for reporting.
 */
export async function expectTextInsideFields(bytes: Uint8Array, expected: Record<string, string>): Promise<number> {
  const original = await PDFDocument.load(bytes);
  const rects = widgetRects(original);
  const drawn = await drawnText(bytes);
  let checked = 0;
  for (const [field, value] of Object.entries(expected)) {
    const fieldRects = rects.get(field);
    expect(fieldRects, `field ${field} exists`).toBeDefined();
    for (const line of value.split('\n')) {
      // The drawn item inside this field's rectangle that carries this line.
      const candidates = drawn.filter((d) => d.str.trim() === line.trim());
      expect(candidates.length, `"${line}" is drawn on the page`).toBeGreaterThan(0);
      const placed = candidates.find((d) => fieldRects!.some((r) => inside(d.box, r)));
      expect(
        placed,
        `"${line}" is drawn inside ${field} with ${REQUIRED_PADDING}pt side padding ${JSON.stringify(fieldRects)}; drawn at ${JSON.stringify(candidates.map((c) => c.box))}`,
      ).toBeDefined();
      checked++;
    }
  }
  return checked;
}

/** Render every page of the PDF in the browser with pdf.js (widget appearance streams drawn) and screenshot it. */
export async function screenshotPdfPages(page: Page, bytes: Uint8Array, pathPrefix: string): Promise<string[]> {
  const base64 = Buffer.from(bytes).toString('base64');
  const pageCount: number = await page.evaluate(async (data) => {
    // Served by the Vite dev server from the installed pdfjs-dist.
    const url = '/node_modules/pdfjs-dist/build/pdf.mjs';
    const pdfjs = (await import(/* @vite-ignore */ url)) as typeof import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const doc = await pdfjs.getDocument({ data: raw }).promise;
    const host = document.createElement('div');
    host.id = 'pdf-pages';
    document.body.replaceChildren(host);
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      const viewport = p.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.dataset['page'] = String(n);
      host.appendChild(canvas);
      // ENABLE draws each widget's own appearance stream, as a printed or flattened view
      // would. ENABLE_FORMS leaves form widgets to an HTML form layer that this canvas
      // never has, which showed empty text fields and every option as selected.
      await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    }
    return doc.numPages;
  }, base64);
  const files: string[] = [];
  for (let n = 1; n <= pageCount; n++) {
    const file = `${pathPrefix}-page-${n}.png`;
    await page.locator(`canvas[data-page="${n}"]`).screenshot({ path: file });
    files.push(file);
  }
  return files;
}
