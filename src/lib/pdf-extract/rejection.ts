/**
 * src/lib/pdf-extract/rejection.ts
 *
 * PDF pre-flight rejection checks, in order:
 * 1. TOO_LARGE       file > 10,485,760 bytes (10 MiB, decision 7)
 * 2. INVALID_PDF     PDFDocument.load throws
 * 3. ENCRYPTED       the document has /Encrypt
 * 4. XFA             /AcroForm has a non-empty /XFA (checked before any getForm() call,
 *                    because getForm() deletes XFA in pdf-lib 1.17.1; decision 12)
 * 5. TOO_MANY_PAGES  more than 20 pages
 * 6. TOO_MANY_FIELDS more than 150 logical answer fields
 * 7. SIGNED          a signature field whose /V resolves to a dictionary
 * 8. NO_FIELDS       zero logical answer fields
 *
 * Fields are counted with the same traversal the extraction uses (fields.ts),
 * so a radio group with many widgets counts once and pushbuttons count nowhere.
 * This module never throws for malformed input.
 */

import { PDFArray, PDFDict, PDFDocument, PDFStream } from 'pdf-lib';
import { collectLogicalFields, isAnswerField, isSignaturePopulated, type LogicalField } from './fields.js';
import { getAny, resolveAs, streamSize } from './pdf-objects.js';

/** Maximum allowed file size in bytes (10 MiB). */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10,485,760
export const MAX_PAGES = 20;
export const MAX_FIELDS = 150;

export type RejectionCode =
  | 'TOO_LARGE'
  | 'ENCRYPTED'
  | 'INVALID_PDF'
  | 'XFA'
  | 'TOO_MANY_PAGES'
  | 'TOO_MANY_FIELDS'
  | 'SIGNED'
  | 'NO_FIELDS';

export interface RejectionResult {
  rejected: true;
  code: RejectionCode;
  /** i18n message key shown to the user */
  messageKey: string;
}

export interface AcceptedResult {
  rejected: false;
  pdfDoc: PDFDocument;
  /** Logical answer fields (pushbuttons excluded), in document order. */
  fields: LogicalField[];
}

export type CheckResult = RejectionResult | AcceptedResult;

const MESSAGE_KEYS: Record<RejectionCode, string> = {
  TOO_LARGE: 'upload.error.tooLarge',
  ENCRYPTED: 'upload.error.encrypted',
  INVALID_PDF: 'upload.error.invalidPdf',
  XFA: 'upload.error.xfa',
  TOO_MANY_PAGES: 'upload.error.tooManyPages',
  TOO_MANY_FIELDS: 'upload.error.tooManyFields',
  SIGNED: 'upload.error.signed',
  NO_FIELDS: 'upload.error.noFields',
};

export function rejection(code: RejectionCode): RejectionResult {
  return { rejected: true, code, messageKey: MESSAGE_KEYS[code] };
}

/**
 * True when the AcroForm carries XFA content. An empty array or a stream with
 * zero bytes is not XFA.
 */
export function hasXfa(pdfDoc: PDFDocument): boolean {
  const context = pdfDoc.context;
  const acroForm = resolveAs(context, getAny(pdfDoc.catalog, 'AcroForm'), PDFDict);
  if (!acroForm) return false;
  const xfa = getAny(acroForm, 'XFA');
  if (xfa instanceof PDFArray) return xfa.size() > 0;
  if (xfa instanceof PDFStream) return (streamSize(xfa) ?? 1) > 0;
  return false;
}

/** Run all rejection checks. Returns the loaded document and its fields when accepted. */
export async function checkPdf(fileBytes: ArrayBuffer | Uint8Array): Promise<CheckResult> {
  if (fileBytes.byteLength > MAX_FILE_SIZE_BYTES) return rejection('TOO_LARGE');

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(fileBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    return rejection('INVALID_PDF');
  }

  try {
    if (pdfDoc.isEncrypted) return rejection('ENCRYPTED');
    if (hasXfa(pdfDoc)) return rejection('XFA');
    if (pdfDoc.getPageCount() > MAX_PAGES) return rejection('TOO_MANY_PAGES');

    const all = collectLogicalFields(pdfDoc);
    const fields = all.filter(isAnswerField);
    if (fields.length > MAX_FIELDS) return rejection('TOO_MANY_FIELDS');
    // Every logical field, answerable or not: a signed node must never hide behind a duplicate.
    if (all.some(isSignaturePopulated)) return rejection('SIGNED');
    if (fields.length === 0) return rejection('NO_FIELDS');

    return { rejected: false, pdfDoc, fields };
  } catch {
    // A structure pdf-lib could load but not walk is treated as an unreadable PDF.
    return rejection('INVALID_PDF');
  }
}
