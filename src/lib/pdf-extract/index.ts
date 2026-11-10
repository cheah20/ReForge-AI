/**
 * src/lib/pdf-extract/index.ts
 *
 * Public API: extractFields(pdfBytes) runs the rejection checks, extracts
 * AcroForm field evidence, adds per-widget page snippets from pdf.js, and
 * computes the SHA-256 content hash.
 */

import type { FieldEvidence } from '../../shared/types.js';
import { checkPdf, type RejectionCode } from './rejection.js';
import { extractAcroFormFields } from './acroform.js';
import { computePageSnippets, toBboxBottomOrigin } from './page-text.js';

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

/** SHA-256 hex digest using Web Crypto (available in browsers and Node 20+) */
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

/** Fill pageSnippet for every widget using pdf.js text content. */
async function addPageSnippets(
  bytes: Uint8Array,
  fields: FieldEvidence[],
): Promise<void> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const widgetsOnPage = fields.flatMap((f) =>
        f.widgets.filter((w) => w.pageNumber === p),
      );
      if (widgetsOnPage.length === 0) continue;

      const page = await doc.getPage(p);
      const pageHeight = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      const items = content.items.flatMap((i) =>
        'str' in i
          ? [{ str: i.str, transform: i.transform as number[], width: i.width, height: i.height }]
          : [],
      );

      const bboxes = widgetsOnPage.map((w) => toBboxBottomOrigin(w, pageHeight));
      const snippets = computePageSnippets(items, widgetsOnPage, pageHeight, bboxes);
      widgetsOnPage.forEach((w, i) => {
        w.pageSnippet = snippets[i] ?? '';
      });
    }
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractFields(
  pdfBytes: ArrayBuffer | Uint8Array,
): Promise<ExtractionResult> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  const check = await checkPdf(bytes);
  if (check.rejected) {
    return { ok: false, code: check.code, messageKey: check.messageKey };
  }

  const fields = extractAcroFormFields(check.pdfDoc);
  const fileHash = await sha256Hex(bytes);
  await addPageSnippets(bytes, fields);

  return {
    ok: true,
    fields,
    fileHash,
    pageCount: check.pdfDoc.getPageCount(),
  };
}
