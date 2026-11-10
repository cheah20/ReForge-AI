/**
 * src/lib/pdf-extract/rejection.ts
 *
 * PDF pre-flight rejection checks. All eight checks are performed in order:
 * 1. TOO_LARGE    — file > 10,485,760 bytes (10 MiB, per decision 7)
 * 2. ENCRYPTED    — /Encrypt present (checked via ignoreEncryption + isEncrypted)
 * 3. INVALID_PDF  — PDFDocument.load throws
 * 4. XFA          — /AcroForm has a nonempty /XFA entry (checked before getForm())
 * 5. TOO_MANY_PAGES — pages > 20
 * 6. TOO_MANY_FIELDS — terminal fields > 150
 * 7. SIGNED       — any /Sig widget with a populated /V
 * 8. NO_FIELDS    — zero terminal interactive fields
 *
 * Per decision 12: XFA is inspected using the low-level dictionary API BEFORE
 * calling getForm(), because getForm() deletes XFA in pdf-lib 1.17.1.
 * Per decision 7: 10 MB = 10,485,760 bytes.
 */

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFNull, PDFStream } from 'pdf-lib';

/** Maximum allowed file size in bytes (10 MiB) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10,485,760

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
}

export type CheckResult = RejectionResult | AcceptedResult;

/** Map rejection codes to i18n message keys */
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

function reject(code: RejectionCode): RejectionResult {
  return { rejected: true, code, messageKey: MESSAGE_KEYS[code] };
}

/**
 * Check if a /Sig field widget has a populated /V (structural detection only —
 * no cryptographic validation).
 */
function isSignaturePopulated(fieldDict: PDFDict): boolean {
  const v = fieldDict.lookupMaybe(PDFName.of('V'), PDFDict);
  if (v instanceof PDFDict) {
    // Check for /Contents and /ByteRange — indicators of a real signature
    const contents = v.lookup(PDFName.of('Contents'));
    const byteRange = v.lookup(PDFName.of('ByteRange'));
    if (contents && byteRange) return true;
    // Also accept if /Filter is present (indicates a signature dict)
    const filter = v.lookup(PDFName.of('Filter'));
    if (filter) return true;
  }
  return false;
}

/**
 * Recursively collect all terminal fields from an AcroForm /Fields array.
 * Terminal fields are those with /FT set (not just parent container nodes).
 */
function collectTerminalFields(
  pdfDoc: PDFDocument,
  fieldsArray: PDFArray,
  result: PDFDict[],
): void {
  for (let i = 0; i < fieldsArray.size(); i++) {
    const item = fieldsArray.get(i);
    // Resolve indirect references
    let fieldDict: PDFDict | undefined;
    try {
      if (item instanceof PDFRef) {
        const resolved = pdfDoc.context.lookupMaybe(item, PDFDict);
        if (resolved instanceof PDFDict) fieldDict = resolved;
      } else if (item instanceof PDFDict) {
        fieldDict = item;
      }
    } catch {
      continue;
    }

    if (!fieldDict) continue;

    const ft = fieldDict.lookup(PDFName.of('FT'));
    const kids = fieldDict.lookupMaybe(PDFName.of('Kids'), PDFArray);

    if (kids instanceof PDFArray) {
      // This is a parent node — recurse into children
      collectTerminalFields(pdfDoc, kids, result);
    } else if (ft) {
      // This is a terminal field (has /FT)
      result.push(fieldDict);
    }
  }
}

/**
 * Run all eight rejection checks in order.
 * Returns a RejectionResult if any check fails, or AcceptedResult with the
 * loaded PDFDocument if all checks pass.
 */
export async function checkPdf(
  fileBytes: ArrayBuffer | Uint8Array,
): Promise<CheckResult> {
  // Check 1: file size
  const byteLength =
    fileBytes instanceof ArrayBuffer ? fileBytes.byteLength : fileBytes.byteLength;
  if (byteLength > MAX_FILE_SIZE_BYTES) {
    return reject('TOO_LARGE');
  }

  // Check 2 + 3: encrypted / invalid PDF
  // Load with ignoreEncryption: true so we can inspect isEncrypted
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(fileBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch {
    return reject('INVALID_PDF');
  }

  if (pdfDoc.isEncrypted) {
    return reject('ENCRYPTED');
  }

  // Check 4: XFA — inspect before getForm() (which deletes XFA in pdf-lib 1.17.1)
  // Per decision 12: check /AcroForm → /XFA using low-level dict API
  const catalogDict = pdfDoc.catalog;
  const acroFormRef = catalogDict.lookup(PDFName.of('AcroForm'));
  let acroFormDict: PDFDict | undefined;
  if (acroFormRef instanceof PDFRef) {
    const resolved = pdfDoc.context.lookupMaybe(acroFormRef, PDFDict);
    if (resolved instanceof PDFDict) acroFormDict = resolved;
  } else if (acroFormRef instanceof PDFDict) {
    acroFormDict = acroFormRef;
  }

  if (acroFormDict) {
    const xfa = acroFormDict.lookup(PDFName.of('XFA'));
    // /XFA exists and is nonempty (not null, not an empty array/stream)
    if (xfa && xfa !== PDFNull) {
      if (xfa instanceof PDFArray && xfa.size() === 0) {
        // empty array — not XFA
      } else {
        return reject('XFA');
      }
    }
  }

  // Check 5: page count
  if (pdfDoc.getPageCount() > 20) {
    return reject('TOO_MANY_PAGES');
  }

  // Collect terminal fields for checks 6, 7, 8
  const terminalFields: PDFDict[] = [];
  if (acroFormDict) {
    const fieldsVal = acroFormDict.lookupMaybe(PDFName.of('Fields'), PDFArray);
    if (fieldsVal instanceof PDFArray) {
      collectTerminalFields(pdfDoc, fieldsVal, terminalFields);
    }
  }

  // Check 6: too many fields
  if (terminalFields.length > 150) {
    return reject('TOO_MANY_FIELDS');
  }

  // Check 7: signed — any /Sig widget with populated /V
  for (const field of terminalFields) {
    const ft = field.lookup(PDFName.of('FT'));
    if (ft instanceof PDFName && ft.asString() === '/Sig') {
      if (isSignaturePopulated(field)) {
        return reject('SIGNED');
      }
    }
  }

  // Check 8: no fields
  if (terminalFields.length === 0) {
    return reject('NO_FIELDS');
  }

  return { rejected: false, pdfDoc };
}
