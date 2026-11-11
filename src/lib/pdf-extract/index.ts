/**
 * src/lib/pdf-extract/index.ts
 *
 * Public API: extractFields(pdfBytes) runs the rejection checks, builds field
 * evidence, adds per-widget page snippets from pdf.js and computes the SHA-256
 * content hash.
 *
 * extractFields never throws. Any unexpected error after the rejection checks
 * returns INVALID_PDF. If pdf.js cannot read the document or a page, the fields
 * are kept and the affected snippets stay empty.
 */

import { PDFArray, PDFDict, type PDFDocument } from 'pdf-lib';
import type { FieldEvidence } from '../../shared/types.js';
import { buildEvidence, type ExtractedField } from './acroform.js';
import { computeOptionLabels, computePageSnippets, isFiniteRect, type TextItem } from './page-text.js';
import { getAny, getNameText, getRect, resolveAs, type PdfRect } from './pdf-objects.js';
import { checkPdf, rejection, type RejectionCode } from './rejection.js';

export type ExtractionResult =
  | {
      ok: true;
      fields: FieldEvidence[];
      /** SHA-256 hex of the PDF bytes */
      fileHash: string;
      pageCount: number;
    }
  | {
      ok: false;
      code: RejectionCode;
      /** i18n message key */
      messageKey: string;
    };

/**
 * Loads the text items of the given 1-based pages. A page missing from the
 * returned map gets empty snippets. May throw; the caller handles failures.
 */
export type PageTextLoader = (bytes: Uint8Array, pageNumbers: number[]) => Promise<Map<number, TextItem[]>>;

export interface ExtractOptions {
  /** Replaces the pdf.js text loader (used by tests). */
  loadPageText?: PageTextLoader;
}

/** SHA-256 hex digest using Web Crypto (available in browsers and Node 20+). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type PdfJsModule = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJsModule> | null = null;

/** Load pdf.js lazily. Node (tests) uses the legacy build; browsers the standard one. */
function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    const isNode = typeof process !== 'undefined' && !!process.versions?.node;
    pdfjsPromise = isNode
      ? (import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJsModule>)
      : import('pdfjs-dist');
  }
  return pdfjsPromise;
}

/** Default loader: pdf.js getTextContent(), one page at a time; a failing page is skipped. */
export const pdfJsPageText: PageTextLoader = async (bytes, pageNumbers) => {
  const pdfjs = await loadPdfJs();
  // pdf.js rejects Node Buffers, so always pass a plain Uint8Array copy.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const result = new Map<number, TextItem[]>();
  try {
    const doc = await task.promise;
    for (const p of pageNumbers) {
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        result.set(
          p,
          content.items.flatMap((i) =>
            'str' in i
              ? [{ str: i.str, transform: i.transform as number[], width: i.width, height: i.height }]
              : [],
          ),
        );
      } catch {
        // Leave this page without text: its snippets stay empty.
      }
    }
  } finally {
    await task.destroy();
  }
  return result;
};

/**
 * Pages whose geometry we trust for the privacy check: rotation 0 and a crop
 * box starting at (0,0). Other pages get no snippets.
 */
function snippetSafePages(pdfDoc: PDFDocument): Set<number> {
  const safe = new Set<number>();
  pdfDoc.getPages().forEach((page, i) => {
    try {
      const angle = ((page.getRotation().angle % 360) + 360) % 360;
      const crop = page.getCropBox();
      if (angle === 0 && crop.x === 0 && crop.y === 0) safe.add(i);
    } catch {
      // Unreadable geometry: no snippets for this page.
    }
  });
  return safe;
}

/**
 * Privacy guard rectangles for one page (review 2, item 1): every widget
 * annotation listed in the page's /Annots (any field type, nameless fields,
 * pushbuttons, widgets past the per-field cap, orphan widgets outside the field
 * tree). Returns undefined, meaning "no snippets for this page", when an
 * annotation cannot be resolved or a widget rectangle is malformed.
 */
export function pageGuardRects(pdfDoc: PDFDocument, pageIndex: number): PdfRect[] | undefined {
  try {
    const page = pdfDoc.getPage(pageIndex);
    const ctx = pdfDoc.context;
    const raw = getAny(page.node, 'Annots');
    if (raw === undefined) return [];
    const annots = resolveAs(ctx, raw, PDFArray);
    if (!annots) return undefined;
    const rects: PdfRect[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const annot = resolveAs(ctx, annots.get(i), PDFDict);
      if (!annot) return undefined;
      const isWidget = getNameText(annot, 'Subtype') === 'Widget' || getAny(annot, 'FT') !== undefined;
      if (!isWidget) continue;
      const rect = getRect(ctx, annot);
      if (!rect || !isFiniteRect(rect)) return undefined;
      rects.push(rect);
    }
    return rects;
  } catch {
    return undefined;
  }
}

async function addPageSnippets(
  bytes: Uint8Array,
  pdfDoc: PDFDocument,
  extracted: ExtractedField[],
  loader: PageTextLoader,
): Promise<void> {
  const safe = snippetSafePages(pdfDoc);
  // Pages whose widgets cannot all be located get no snippets.
  const guardsByPage = new Map<number, PdfRect[]>();
  for (const i of [...safe]) {
    const guards = pageGuardRects(pdfDoc, i);
    if (guards) guardsByPage.set(i, guards);
    else safe.delete(i);
  }
  const pageNumbers = [
    ...new Set(extracted.flatMap((f) => f.pdfWidgets.map((w) => w.pageIndex))),
  ]
    .filter((i) => safe.has(i))
    .sort((a, b) => a - b)
    .map((i) => i + 1);
  if (pageNumbers.length === 0) return;

  let text: Map<number, TextItem[]>;
  try {
    text = await loader(bytes, pageNumbers);
  } catch {
    return; // pdf.js could not read the document: keep fields, snippets stay empty.
  }

  for (const pageNumber of pageNumbers) {
    const items = text.get(pageNumber);
    if (!items) continue;
    const onPage = extracted.flatMap((f) =>
      f.pdfWidgets.flatMap((w, wi) => (w.pageIndex + 1 === pageNumber ? [{ f, w, wi }] : [])),
    );
    const widgetRects = onPage.map((x) => x.w.rect);
    // Guards: every widget in /Annots, plus extracted widgets placed only through /P.
    const guards = [...(guardsByPage.get(pageNumber - 1) ?? []), ...widgetRects];
    const snippets = computePageSnippets(items, widgetRects, guards);
    const optionLabels = computeOptionLabels(items, widgetRects, guards);
    onPage.forEach(({ f, w, wi }, k) => {
      const widget = f.evidence.widgets[wi];
      if (widget) widget.pageSnippet = snippets[k] ?? '';
      // A radio option shows the text printed beside its button ("Perempuan"), not its export value ("F").
      const label = optionLabels[k];
      const option = w.exportValue !== undefined ? f.evidence.options?.find((o) => o.exportValue === w.exportValue) : undefined;
      if (label && option && option.displayLabel === option.exportValue) option.displayLabel = label;
    });
  }
}

export async function extractFields(
  pdfBytes: ArrayBuffer | Uint8Array,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  try {
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const check = await checkPdf(bytes);
    if (check.rejected) return { ok: false, code: check.code, messageKey: check.messageKey };

    const extracted = buildEvidence(check.pdfDoc, check.fields);
    const fileHash = await sha256Hex(bytes);
    await addPageSnippets(bytes, check.pdfDoc, extracted, options.loadPageText ?? pdfJsPageText);

    return {
      ok: true,
      fields: extracted.map((e) => e.evidence),
      fileHash,
      pageCount: check.pdfDoc.getPageCount(),
    };
  } catch {
    const r = rejection('INVALID_PDF');
    return { ok: false, code: r.code, messageKey: r.messageKey };
  }
}
