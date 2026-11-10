/**
 * scripts/create-fixtures/encrypted.ts
 *
 * Generates fixtures/encrypted.pdf using qpdf.
 *
 * This script first creates an unencrypted base PDF with two AcroForm text fields,
 * then uses qpdf to encrypt it with AES-256.
 *
 * Prerequisites:
 *   - qpdf installed and on PATH (https://qpdf.readthedocs.io/)
 *   - Verified with: qpdf 11.x
 *
 * User password:  fixture-open-only
 * Owner password: fixture-owner-only
 *
 * Run with: npx tsx scripts/create-fixtures/encrypted.ts
 *
 * Reproducibility: the qpdf encryption command is deterministic for the same
 * inputs except for AES-256 IV randomness; re-running produces a structurally
 * valid but byte-different encrypted PDF each time, which is expected.
 *
 * Verification: open the output in a PDF viewer and confirm it prompts for a
 * password; entering 'fixture-open-only' should open the document.
 */

import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
} from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const FIXTURES_DIR = path.join(process.cwd(), 'fixtures');
const UNENCRYPTED_PATH = path.join(FIXTURES_DIR, '_encrypted-base.pdf');
const ENCRYPTED_PATH = path.join(FIXTURES_DIR, 'encrypted.pdf');

const USER_PASSWORD = 'fixture-open-only';
const OWNER_PASSWORD = 'fixture-owner-only';

const A4_HEIGHT = 841.89;
const A4_WIDTH = 595.28;

function toNativeRect(
  rect: [number, number, number, number],
  pageHeight: number,
): [number, number, number, number] {
  const [l, t, r, b] = rect;
  return [l, pageHeight - b, r, pageHeight - t];
}

async function createBasePdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  page.drawText('Paper Cloud Fictional Office', {
    x: 36, y: A4_HEIGHT - 60, size: 12,
  });
  page.drawText('Encrypted Synthetic Form', {
    x: 36, y: A4_HEIGHT - 80, size: 18,
  });
  page.drawText('SYNTHETIC TEST ONLY', {
    x: 36, y: A4_HEIGHT - 100, size: 11,
  });

  const context = pdfDoc.context;
  const fieldsArray = context.obj([]);
  const annots: ReturnType<typeof context.register>[] = [];

  page.drawText('Test name', { x: 36, y: A4_HEIGHT - 140, size: 10 });
  const nameWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Rect: context.obj(toNativeRect([36, 150, 300, 176], A4_HEIGHT)),
    T: PDFString.of('probe.name'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 40,
    P: page.ref,
  });
  const nameRef = context.register(nameWidget);
  (fieldsArray as import('pdf-lib').PDFArray).push(nameRef);
  annots.push(nameRef);

  page.drawText('Test reference', { x: 36, y: A4_HEIGHT - 220, size: 10 });
  const refWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Rect: context.obj(toNativeRect([36, 230, 300, 256], A4_HEIGHT)),
    T: PDFString.of('probe.reference'),
    TU: PDFString.of('Test reference'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 12,
    P: page.ref,
  });
  const refRef = context.register(refWidget);
  (fieldsArray as import('pdf-lib').PDFArray).push(refRef);
  annots.push(refRef);

  page.node.set(PDFName.of('Annots'), context.obj(annots));
  const fieldsRef = context.register(fieldsArray);
  const acroForm = context.obj({ Fields: fieldsRef });
  pdfDoc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  const bytes = await pdfDoc.save();
  fs.writeFileSync(UNENCRYPTED_PATH, bytes);
}

async function main() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  console.log('Creating base (unencrypted) PDF…');
  await createBasePdf();

  console.log('Encrypting with qpdf (AES-256)…');
  try {
    // qpdf encryption command:
    // --encrypt <user-pw> <owner-pw> 256 -- <input> <output>
    execSync(
      `qpdf --encrypt "${USER_PASSWORD}" "${OWNER_PASSWORD}" 256 -- "${UNENCRYPTED_PATH}" "${ENCRYPTED_PATH}"`,
      { stdio: 'inherit' },
    );
    console.log(`Created: ${ENCRYPTED_PATH}`);
  } catch {
    console.error(
      'qpdf not found or failed. Install qpdf (https://qpdf.readthedocs.io/) and re-run.',
    );
    process.exit(1);
  } finally {
    // Clean up temporary base file
    if (fs.existsSync(UNENCRYPTED_PATH)) {
      fs.unlinkSync(UNENCRYPTED_PATH);
    }
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
