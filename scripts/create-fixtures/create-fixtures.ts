/**
 * scripts/create-fixtures/create-fixtures.ts
 *
 * Generates all synthetic AcroForm PDF fixtures for FormBridge tests.
 * Run with: npx tsx scripts/create-fixtures/create-fixtures.ts
 *
 * Each fixture is specified in fixtures-spec.md. This script creates:
 * - fixtures/clinic-registration.pdf (primary Nov 17 fixture)
 * - fixtures/school-enrolment.pdf
 * - fixtures/no-fields.pdf
 * - fixtures/xfa-acroform.pdf
 * - fixtures/sig-empty.pdf
 * - fixtures/sig-populated.pdf
 * - fixtures/prefilled-field.pdf (decision 20 / fixtures-spec §10)
 * - fixtures/us-community-clinic.pdf (Dec 1 fixture)
 *
 * Note: fixtures/encrypted.pdf is created separately by encrypted.ts using qpdf.
 * Note: fixtures/chinese-school-form.pdf is created by the CJK spike (task 41.3).
 */

import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFString,
  PDFRef,
  PDFHexString,
  StandardFonts,
  rgb,
  PDFStream,
  PDFRawStream,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = path.join(process.cwd(), 'fixtures');

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Points to mm helper */
const mm = (v: number) => v * 2.8346;

/** A4 dimensions */
const A4 = { width: 595.28, height: 841.89 };
/** US Letter dimensions */
const LETTER = { width: 612, height: 792 };

/**
 * Draws text on a page at the given position using a standard font.
 * top-origin coordinates (will be converted to PDF bottom-origin).
 */
function drawText(
  page: ReturnType<PDFDocument['addPage']>,
  text: string,
  x: number,
  yTop: number,
  opts: { size?: number; color?: [number, number, number] } = {},
) {
  const { height } = page.getSize();
  page.drawText(text, {
    x,
    y: height - yTop,
    size: opts.size ?? 10,
    color: rgb(...(opts.color ?? [0, 0, 0])),
  });
}

/**
 * Converts top-origin [left, top, right, bottom] to PDF native [left, bottom, right, top]
 */
function toNativeRect(
  rect: [number, number, number, number],
  pageHeight: number,
): [number, number, number, number] {
  const [l, t, r, b] = rect;
  return [l, pageHeight - b, r, pageHeight - t];
}

/** Add an AcroForm dict to a document, returning the form's field array */
function initAcroForm(pdfDoc: PDFDocument): PDFArray {
  const context = pdfDoc.context;
  const fieldsArray = context.obj([]);
  const acroForm = context.obj({
    Fields: fieldsArray,
  });
  const catalog = pdfDoc.catalog;
  catalog.set(PDFName.of('AcroForm'), pdfDoc.context.register(acroForm));
  return fieldsArray as PDFArray;
}

// ---------------------------------------------------------------------------
// Fixture 5: no-fields.pdf
// ---------------------------------------------------------------------------

async function createNoFieldsPdf() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([A4.width, A4.height]);

  drawText(page, 'Paper Cloud Fictional Office', 36, 60, { size: 12, color: [0.3, 0.3, 0.3] });
  drawText(page, 'Synthetic non-interactive form', 36, 90, { size: 18 });
  drawText(page, 'SYNTHETIC TEST ONLY', 36, 120, { size: 11, color: [0.5, 0, 0] });
  drawText(page, 'Name', 36, 180, { size: 10 });
  page.drawRectangle({ x: 36, y: A4.height - 210, width: 200, height: 18, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
  drawText(page, 'Date', 36, 240, { size: 10 });
  page.drawRectangle({ x: 36, y: A4.height - 270, width: 200, height: 18, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'no-fields.pdf'), bytes);
  console.log('Created: no-fields.pdf');
}

// ---------------------------------------------------------------------------
// Fixture 7: xfa-acroform.pdf  (has both AcroForm + XFA)
// ---------------------------------------------------------------------------

async function createXfaAcroformPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4.width, A4.height]);
  drawText(page, 'Paper Cloud Fictional Office', 36, 60, { size: 12, color: [0.3, 0.3, 0.3] });
  drawText(page, 'Synthetic XFA Detection Form', 36, 90, { size: 18 });
  drawText(page, 'SYNTHETIC TEST ONLY', 36, 120, { size: 11, color: [0.5, 0, 0] });

  // Create the AcroForm + two regular fields
  const context = pdfDoc.context;
  const fieldsArray = context.obj([]) as PDFArray;

  // Field 1: probe.name
  drawText(page, 'Test name', 36, 140, { size: 10 });
  const nameWidgetRect = toNativeRect([36, 150, 300, 176], A4.height);
  const nameWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Rect: context.obj(nameWidgetRect),
    T: PDFString.of('probe.name'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 40,
    P: pdfDoc.getPage(0).ref,
  });
  const nameRef = context.register(nameWidget);
  fieldsArray.push(nameRef);

  // Field 2: probe.reference
  drawText(page, 'Test reference', 36, 220, { size: 10 });
  const refWidgetRect = toNativeRect([36, 230, 300, 256], A4.height);
  const refWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Rect: context.obj(refWidgetRect),
    T: PDFString.of('probe.reference'),
    TU: PDFString.of('Test reference'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 12,
    P: pdfDoc.getPage(0).ref,
  });
  const refRef = context.register(refWidget);
  fieldsArray.push(refRef);

  // Add page Annots
  pdfDoc.getPage(0).node.set(PDFName.of('Annots'), context.obj([nameRef, refRef]));

  // XFA stream — minimal valid XDP document
  const xfaXml = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/2.8/">
    <subform name="root">
      <field name="syntheticField">
        <ui><textEdit/></ui>
      </field>
    </subform>
  </template>
</xdp:xdp>`;
  const xfaBytes = Buffer.from(xfaXml, 'utf8');
  const xfaStream = context.stream(xfaXml);
  const xfaRef = context.register(xfaStream);

  const fieldsRef = context.register(fieldsArray);
  const acroForm = context.obj({
    Fields: fieldsRef,
    XFA: xfaRef,
  });
  pdfDoc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'xfa-acroform.pdf'), bytes);
  console.log('Created: xfa-acroform.pdf');
}

// ---------------------------------------------------------------------------
// Shared helper: create a minimal signature field dict
// ---------------------------------------------------------------------------

function makeSigField(
  pdfDoc: PDFDocument,
  name: string,
  rectNative: [number, number, number, number],
  pageRef: PDFRef,
  populated: boolean,
) {
  const context = pdfDoc.context;

  const fieldDict: Record<string, any> = {
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    Rect: context.obj(rectNative),
    T: PDFString.of(name),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    P: pageRef,
  };

  if (populated) {
    // Minimal populated signature dictionary (structural only; not cryptographically valid)
    const sigDict = context.obj({
      Type: PDFName.of('Sig'),
      Filter: PDFName.of('Adobe.PPKLite'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      // Non-empty synthetic Contents (hex) — just enough bytes to look populated
      Contents: PDFHexString.of('AABBCCDDEEFF00112233445566778899'),
      // ByteRange: covers the whole file minus the Contents hex
      ByteRange: context.obj([0, 100, 200, 100]),
    });
    fieldDict['V'] = context.register(sigDict);
  }

  return context.obj(fieldDict);
}

// ---------------------------------------------------------------------------
// Fixture 8: sig-empty.pdf
// ---------------------------------------------------------------------------

async function createSigEmptyPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4.width, A4.height]);
  drawText(page, 'Paper Cloud Fictional Office', 36, 60, { size: 12, color: [0.3, 0.3, 0.3] });
  drawText(page, 'Unsigned Synthetic Form', 36, 90, { size: 18 });
  drawText(page, 'SYNTHETIC TEST ONLY', 36, 120, { size: 11, color: [0.5, 0, 0] });

  const context = pdfDoc.context;
  const fieldsArray = context.obj([]) as PDFArray;

  // Field: probe.name (required text)
  drawText(page, 'Test name', 36, 140, { size: 10 });
  const nameWidgetRect = toNativeRect([36, 150, 300, 176], A4.height);
  const nameWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Ff: 2, // Required flag
    Rect: context.obj(nameWidgetRect),
    T: PDFString.of('probe.name'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 40,
    P: page.ref,
  });
  const nameRef = context.register(nameWidget);
  fieldsArray.push(nameRef);

  // Signature field: probe.signature (no /V)
  drawText(page, 'Signature', 36, 250, { size: 10 });
  drawText(page, 'Sign after printing', 36, 268, { size: 9, color: [0.4, 0.4, 0.4] });
  const sigRectNative = toNativeRect([36, 260, 350, 310], A4.height);
  const sigWidget = makeSigField(pdfDoc, 'probe.signature', sigRectNative, page.ref, false);
  const sigRef = context.register(sigWidget);
  fieldsArray.push(sigRef);

  page.node.set(PDFName.of('Annots'), context.obj([nameRef, sigRef]));
  const fieldsRef = context.register(fieldsArray);
  const acroForm = context.obj({ Fields: fieldsRef });
  pdfDoc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'sig-empty.pdf'), bytes);
  console.log('Created: sig-empty.pdf');
}

// ---------------------------------------------------------------------------
// Fixture 9: sig-populated.pdf
// ---------------------------------------------------------------------------

async function createSigPopulatedPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4.width, A4.height]);
  drawText(page, 'Paper Cloud Fictional Office', 36, 60, { size: 12, color: [0.3, 0.3, 0.3] });
  drawText(page, 'Populated Signature Detection Form', 36, 90, { size: 18 });
  drawText(page, 'SYNTHETIC TEST ONLY', 36, 120, { size: 11, color: [0.5, 0, 0] });

  const context = pdfDoc.context;
  const fieldsArray = context.obj([]) as PDFArray;

  // Field: probe.name
  drawText(page, 'Test name', 36, 140, { size: 10 });
  const nameWidgetRect = toNativeRect([36, 150, 300, 176], A4.height);
  const nameWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Rect: context.obj(nameWidgetRect),
    T: PDFString.of('probe.name'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 40,
    P: page.ref,
  });
  const nameRef = context.register(nameWidget);
  fieldsArray.push(nameRef);

  // Signature field with synthetic populated /V
  drawText(page, 'Signature', 36, 250, { size: 10 });
  drawText(page, 'Synthetic signature detector test', 36, 268, { size: 9, color: [0.4, 0.4, 0.4] });
  // Draw appearance text inside signature rect
  const ph = A4.height;
  page.drawText('SYNTHETIC TEST SIGNATURE', {
    x: 40,
    y: ph - 290,
    size: 9,
    color: rgb(0.3, 0.3, 0.3),
  });
  const sigRectNative = toNativeRect([36, 260, 350, 310], A4.height);
  const sigWidget = makeSigField(pdfDoc, 'probe.signature', sigRectNative, page.ref, true);
  const sigRef = context.register(sigWidget);
  fieldsArray.push(sigRef);

  page.node.set(PDFName.of('Annots'), context.obj([nameRef, sigRef]));
  const fieldsRef = context.register(fieldsArray);
  const acroForm = context.obj({ Fields: fieldsRef });
  pdfDoc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'sig-populated.pdf'), bytes);
  console.log('Created: sig-populated.pdf');
}

// ---------------------------------------------------------------------------
// Fixture 10: prefilled-field.pdf (decision 20 / fixtures-spec §10)
// ---------------------------------------------------------------------------

async function createPrefilledFieldPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4.width, A4.height]);
  drawText(page, 'Paper Cloud Fictional Office', 36, 60, { size: 12, color: [0.3, 0.3, 0.3] });
  drawText(page, 'Prefilled Value Privacy Test', 36, 90, { size: 18 });
  drawText(page, 'SYNTHETIC TEST ONLY', 36, 120, { size: 11, color: [0.5, 0, 0] });
  drawText(page, 'Test fields', 36, 100, { size: 12 });

  const context = pdfDoc.context;
  const fieldsArray = context.obj([]) as PDFArray;
  const annots: PDFRef[] = [];

  // Helper to build a minimal appearance stream (shows the field value text)
  function makeTextAppearance(value: string): PDFRef {
    const streamContent = `BT /Helv 10 Tf 0 0 Td (${value}) Tj ET`;
    const ap = context.stream(streamContent, { Subtype: PDFName.of('Form') });
    return context.register(ap);
  }

  // Field 1: person.name — editable, has /V + /DV + visible appearance
  // CRITICAL: sentinel VALUE_ONLY_CANARY_7Q2 is ONLY in field /V, never in labels/tooltips/nearby text
  drawText(page, 'Full name', 36, 140, { size: 10 });
  const nameRect = toNativeRect([36, 150, 559, 178], A4.height);
  const nameApRef = makeTextAppearance('VALUE_ONLY_CANARY_7Q2');
  const nameWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Rect: context.obj(nameRect),
    T: PDFString.of('person.name'),
    TU: PDFString.of('Full name'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 70,
    V: PDFString.of('VALUE_ONLY_CANARY_7Q2'),
    DV: PDFString.of('VALUE_ONLY_CANARY_7Q2'),
    AP: context.obj({ N: nameApRef }),
    P: page.ref,
  });
  const nameRef = context.register(nameWidget);
  fieldsArray.push(nameRef);
  annots.push(nameRef);

  // Field 2: office.code — read-only, has /V + /DV + visible appearance
  drawText(page, 'Office code', 36, 240, { size: 10 });
  const officeRect = toNativeRect([36, 250, 559, 278], A4.height);
  const officeApRef = makeTextAppearance('RO_ONLY_CANARY_9R4');
  const officeWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Ff: 1, // ReadOnly
    Rect: context.obj(officeRect),
    T: PDFString.of('office.code'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 40,
    V: PDFString.of('RO_ONLY_CANARY_9R4'),
    DV: PDFString.of('RO_ONLY_CANARY_9R4'),
    AP: context.obj({ N: officeApRef }),
    P: page.ref,
  });
  const officeRef = context.register(officeWidget);
  fieldsArray.push(officeRef);
  annots.push(officeRef);

  // Field 3: Text7 — editable, has /V but NO /AP, NO /DV
  drawText(page, 'Reference', 36, 340, { size: 10 });
  const text7Rect = toNativeRect([36, 350, 559, 378], A4.height);
  const text7Widget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    Rect: context.obj(text7Rect),
    T: PDFString.of('Text7'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 40,
    V: PDFString.of('NO_AP_CANARY_3M8'),
    // Intentionally NO /AP and NO /DV
    P: page.ref,
  });
  const text7Ref = context.register(text7Widget);
  fieldsArray.push(text7Ref);
  annots.push(text7Ref);

  // Field 4: consent.contact — checkbox, initially /Yes
  drawText(page, 'Permit contact', 54, 452, { size: 10 });
  const cbRect = toNativeRect([36, 450, 52, 466], A4.height);
  const cbWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Btn'),
    Rect: context.obj(cbRect),
    T: PDFString.of('consent.contact'),
    V: PDFName.of('Yes'),
    AS: PDFName.of('Yes'),
    AP: context.obj({
      N: context.obj({
        Yes: context.register(context.stream('0.5 g\n0 0 12 12 re\nf\n0 g\n2 2 8 8 re\nf', { Subtype: PDFName.of('Form') })),
        Off: context.register(context.stream('0 g\n0 0 12 12 re\nS', { Subtype: PDFName.of('Form') })),
      }),
    }),
    P: page.ref,
  });
  const cbRef = context.register(cbWidget);
  fieldsArray.push(cbRef);
  annots.push(cbRef);

  // Field 5: office.route — dropdown with initial /V=B, /I=[1]
  drawText(page, 'Routing category', 36, 540, { size: 10 });
  const routeRect = toNativeRect([36, 550, 300, 578], A4.height);
  const routeWidget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Ch'),
    Ff: 131072, // Combo flag
    Rect: context.obj(routeRect),
    T: PDFString.of('office.route'),
    TU: PDFString.of('Select routing category'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    Opt: context.obj([
      context.obj([PDFString.of('A'), PDFString.of('Category A')]),
      context.obj([PDFString.of('B'), PDFString.of('Category B')]),
    ]),
    V: PDFString.of('B'),
    I: context.obj([1]),
    P: page.ref,
  });
  const routeRef = context.register(routeWidget);
  fieldsArray.push(routeRef);
  annots.push(routeRef);

  page.node.set(PDFName.of('Annots'), context.obj(annots));
  const fieldsRef = context.register(fieldsArray);
  const acroForm = context.obj({ Fields: fieldsRef });
  pdfDoc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'prefilled-field.pdf'), bytes);
  console.log('Created: prefilled-field.pdf');
}

// ---------------------------------------------------------------------------
// Fixture 2: school-enrolment.pdf
// ---------------------------------------------------------------------------

async function createSchoolEnrolmentPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4.width, A4.height]);

  drawText(page, 'Sekolah Rekaan Pelangi Kertas / Paper Rainbow Fictional School', 36, 60, { size: 11, color: [0.3, 0.3, 0.3] });
  drawText(page, 'School Enrolment / Pendaftaran Sekolah', 36, 82, { size: 16 });
  drawText(page, 'SYNTHETIC TEST FORM / BORANG UJIAN SINTETIK', 36, 105, { size: 10, color: [0.5, 0, 0] });
  drawText(page, 'Student / Murid', 36, 130, { size: 12 });
  drawText(page, 'Preferences and Declaration / Pilihan dan Pengakuan', 36, 425, { size: 12 });

  const context = pdfDoc.context;
  const fieldsArray = context.obj([]) as PDFArray;
  const annots: PDFRef[] = [];

  function addField(fieldDict: Record<string, any>): PDFRef {
    const widget = context.obj(fieldDict);
    const ref = context.register(widget);
    fieldsArray.push(ref);
    annots.push(ref);
    return ref;
  }

  // 1. student.name
  drawText(page, 'Student name / Nama murid', 36, 150, { size: 10 });
  const snRef = addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2, // Required
    Rect: context.obj(toNativeRect([36, 160, 559, 184], A4.height)),
    T: PDFString.of('student.name'), TU: PDFString.of('Student name / Nama murid'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 70, P: page.ref,
  });

  // 2. Text1 — birth date
  drawText(page, 'Birth date / Tarikh lahir (DD/MM/YYYY)', 36, 200, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2,
    Rect: context.obj(toNativeRect([36, 210, 250, 234], A4.height)),
    T: PDFString.of('Text1'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 10, P: page.ref,
  });

  // 3. guardian.email
  drawText(page, 'Guardian email / E-mel penjaga', 285, 200, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Rect: context.obj(toNativeRect([285, 210, 559, 234], A4.height)),
    T: PDFString.of('guardian.email'), TU: PDFString.of('Guardian email / E-mel penjaga'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 80, P: page.ref,
  });

  // 4. student.notes — multiline
  drawText(page, 'Learning needs / Keperluan pembelajaran', 36, 258, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 4096, // Multiline
    Rect: context.obj(toNativeRect([36, 268, 559, 348], A4.height)),
    T: PDFString.of('student.notes'),
    TU: PDFString.of('Describe learning needs / Terangkan keperluan pembelajaran'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 180, P: page.ref,
  });

  // 5. admission.session — radio group
  drawText(page, 'Session / Sesi', 36, 452, { size: 10 });
  drawText(page, 'Morning / Pagi', 54, 468, { size: 10 });
  drawText(page, 'Afternoon / Petang', 299, 468, { size: 10 });
  // Radio parent field
  const sessionParent = context.obj({
    FT: PDFName.of('Btn'),
    Ff: 32768, // Radio
    T: PDFString.of('admission.session'),
    TU: PDFString.of('Choose one session / Pilih satu sesi'),
    Ff2: 2, // Required
    Kids: context.obj([]),
  });
  const sessionParentRef = context.register(sessionParent);
  fieldsArray.push(sessionParentRef);

  const sessionKids = sessionParent.get(PDFName.of('Kids')) as PDFArray;

  const amWidget = context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'),
    Parent: sessionParentRef,
    Rect: context.obj(toNativeRect([36, 460, 50, 474], A4.height)),
    AS: PDFName.of('Off'),
    AP: context.obj({ N: context.obj({ AM: context.register(context.stream('0 g\n3 3 6 6 re\nf')), Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')) }) }),
    P: page.ref,
  });
  const amRef = context.register(amWidget);
  sessionKids.push(amRef);
  annots.push(amRef);

  const pmWidget = context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'),
    Parent: sessionParentRef,
    Rect: context.obj(toNativeRect([285, 460, 299, 474], A4.height)),
    AS: PDFName.of('Off'),
    AP: context.obj({ N: context.obj({ PM: context.register(context.stream('0 g\n3 3 6 6 re\nf')), Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')) }) }),
    P: page.ref,
  });
  const pmRef = context.register(pmWidget);
  sessionKids.push(pmRef);
  annots.push(pmRef);

  // 6. admission.year — dropdown
  drawText(page, 'Year / Tahun', 36, 510, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Ch'),
    Ff: 131074, // Combo + Required
    Rect: context.obj(toNativeRect([36, 520, 270, 544], A4.height)),
    T: PDFString.of('admission.year'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    Opt: context.obj([
      context.obj([PDFString.of('Y1'), PDFString.of('Year 1 / Tahun 1')]),
      context.obj([PDFString.of('Y2'), PDFString.of('Year 2 / Tahun 2')]),
    ]),
    P: page.ref,
  });

  // 7. Text7 — single-select list box (Ch, no Combo flag)
  drawText(page, 'Club / Kelab', 310, 510, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Ch'),
    Ff: 0, // No Combo, no MultiSelect
    Rect: context.obj(toNativeRect([310, 520, 559, 592], A4.height)),
    T: PDFString.of('Text7'),
    TU: PDFString.of('Choose one club / Pilih satu kelab'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    Opt: context.obj([
      context.obj([PDFString.of('ART'), PDFString.of('Art / Seni')]),
      context.obj([PDFString.of('SCI'), PDFString.of('Science / Sains')]),
      context.obj([PDFString.of('MUS'), PDFString.of('Music / Muzik')]),
    ]),
    P: page.ref,
  });

  // 8. consent.trip — checkbox
  drawText(page, 'Permit school trips / Benarkan lawatan sekolah', 54, 634, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Btn'),
    Rect: context.obj(toNativeRect([36, 620, 50, 634], A4.height)),
    T: PDFString.of('consent.trip'),
    V: PDFName.of('Off'), AS: PDFName.of('Off'),
    AP: context.obj({ N: context.obj({
      Yes: context.register(context.stream('0.5 g\n0 0 12 12 re\nf\n0 g\n2 2 8 8 re\nf')),
      Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')),
    })}),
    P: page.ref,
  });

  // 9. office.code — read-only
  drawText(page, 'Office code / Kod pejabat', 36, 700, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 1, // ReadOnly
    Rect: context.obj(toNativeRect([36, 710, 250, 734], A4.height)),
    T: PDFString.of('office.code'),
    TU: PDFString.of('Office use / Kegunaan pejabat'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    MaxLen: 8, V: PDFString.of('SCH-TST'), DV: PDFString.of('SCH-TST'),
    P: page.ref,
  });

  // 10. consent.signature — signature
  drawText(page, 'Guardian signature / Tandatangan penjaga', 285, 700, { size: 10 });
  const sigRectNative = toNativeRect([285, 710, 559, 768], A4.height);
  const sigWidget = makeSigField(pdfDoc, 'consent.signature', sigRectNative, page.ref, false);
  const sigRef = context.register(sigWidget);
  fieldsArray.push(sigRef);
  annots.push(sigRef);

  page.node.set(PDFName.of('Annots'), context.obj(annots));
  const fieldsRef = context.register(fieldsArray);
  const acroForm = context.obj({ Fields: fieldsRef });
  pdfDoc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'school-enrolment.pdf'), bytes);
  console.log('Created: school-enrolment.pdf');
}

// ---------------------------------------------------------------------------
// Fixture 1: clinic-registration.pdf (primary Nov 17)
// ---------------------------------------------------------------------------

async function createClinicRegistrationPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4.width, A4.height]);

  // Page header
  drawText(page, 'Klinik Rekaan Awan Ungu', 36, 48, { size: 12, color: [0.3, 0.3, 0.3] });
  drawText(page, 'Borang Pendaftaran Pesakit', 36, 68, { size: 18 });
  drawText(page, 'BORANG UJIAN SINTETIK — organisasi dan semua maklumat adalah rekaan.', 36, 90, { size: 9, color: [0.5, 0, 0] });

  // Section headings (at approx y positions per spec)
  drawText(page, 'Maklumat Pesakit', 36, 112, { size: 12 });
  drawText(page, 'Maklumat Hubungan', 36, 284, { size: 12 });
  drawText(page, 'Maklumat Lawatan', 36, 486, { size: 12 });
  drawText(page, 'Pengesahan', 36, 634, { size: 12 });

  const context = pdfDoc.context;
  const fieldsArray = context.obj([]) as PDFArray;
  const annots: PDFRef[] = [];

  function addField(fd: Record<string, any>): PDFRef {
    const w = context.obj(fd);
    const r = context.register(w);
    fieldsArray.push(r);
    annots.push(r);
    return r;
  }

  // --- Patient info section ---

  // patient.fullName (hierarchy: parent T=patient, child T=fullName)
  drawText(page, 'Nama penuh', 36, 122, { size: 10 });
  const patientParent = context.obj({ T: PDFString.of('patient'), Kids: context.obj([]) });
  const patientParentRef = context.register(patientParent);
  fieldsArray.push(patientParentRef);

  const patientKids = patientParent.get(PDFName.of('Kids')) as PDFArray;

  const fullNameWidget = context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: patientParentRef,
    Ff: 2, // Required
    Rect: context.obj(toNativeRect([36, 132, 330, 154], A4.height)),
    T: PDFString.of('fullName'),
    TU: PDFString.of('Nama penuh seperti dalam dokumen pengenalan'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 70, P: page.ref,
  });
  const fullNameRef = context.register(fullNameWidget);
  patientKids.push(fullNameRef);
  annots.push(fullNameRef);

  // Text1 — IC number (no meaningful parent, flat field)
  drawText(page, 'No. Kad Pengenalan', 350, 122, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2,
    Rect: context.obj(toNativeRect([350, 132, 559, 154], A4.height)),
    T: PDFString.of('Text1'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 12, P: page.ref,
  });

  // patient.birthDate
  drawText(page, 'Tarikh Lahir (DD/MM/YYYY)', 36, 172, { size: 10 });
  const birthDateWidget = context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: patientParentRef,
    Ff: 2,
    Rect: context.obj(toNativeRect([36, 182, 190, 204], A4.height)),
    T: PDFString.of('birthDate'),
    TU: PDFString.of('Tarikh lahir dalam format DD/MM/YYYY'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 10, P: page.ref,
  });
  const birthDateRef = context.register(birthDateWidget);
  patientKids.push(birthDateRef);
  annots.push(birthDateRef);

  // patient.gender — radio group
  drawText(page, 'Jantina', 36, 174, { size: 10 });
  drawText(page, 'Perempuan', 238, 192, { size: 10 });
  drawText(page, 'Lelaki', 338, 192, { size: 10 });
  drawText(page, 'Tidak dinyatakan', 418, 192, { size: 10 });
  const genderParent = context.obj({
    FT: PDFName.of('Btn'), Ff: 32768, // Radio
    Parent: patientParentRef,
    T: PDFString.of('gender'),
    TU: PDFString.of('Pilih satu pilihan jantina'),
    Kids: context.obj([]),
  });
  const genderParentRef = context.register(genderParent);
  patientKids.push(genderParentRef);

  const genderKids = genderParent.get(PDFName.of('Kids')) as PDFArray;
  for (const [xLeft, exportVal] of [[220, 'F'], [320, 'M'], [400, 'X']] as [number, string][]) {
    const w = context.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'),
      Parent: genderParentRef,
      Rect: context.obj(toNativeRect([xLeft, 184, xLeft + 14, 198], A4.height)),
      AS: PDFName.of('Off'),
      AP: context.obj({ N: context.obj({
        [exportVal]: context.register(context.stream('0 g\n3 3 6 6 re\nf')),
        Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')),
      })}),
      P: page.ref,
    });
    const wRef = context.register(w);
    genderKids.push(wRef);
    annots.push(wRef);
  }

  // clinic.branchCode — read-only, flat field
  drawText(page, 'Kod cawangan', 36, 222, { size: 10 });
  const clinicParent = context.obj({ T: PDFString.of('clinic'), Kids: context.obj([]) });
  const clinicParentRef = context.register(clinicParent);
  fieldsArray.push(clinicParentRef);
  const branchCodeWidget = context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 1, // ReadOnly
    Rect: context.obj(toNativeRect([36, 232, 190, 254], A4.height)),
    Parent: clinicParentRef,
    T: PDFString.of('branchCode'),
    TU: PDFString.of('Kod cawangan klinik'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 8,
    V: PDFString.of('AU-TEST'), DV: PDFString.of('AU-TEST'),
    P: page.ref,
  });
  const branchCodeRef = context.register(branchCodeWidget);
  (clinicParent.get(PDFName.of('Kids')) as PDFArray).push(branchCodeRef);
  annots.push(branchCodeRef);

  // Text7 — reference code (flat, no /TU)
  drawText(page, 'Rujukan', 350, 222, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Rect: context.obj(toNativeRect([350, 232, 559, 254], A4.height)),
    T: PDFString.of('Text7'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 8, P: page.ref,
  });

  // --- Contact info section ---

  // contact.mobile
  drawText(page, 'Telefon bimbit', 36, 294, { size: 10 });
  const contactParent = context.obj({ T: PDFString.of('contact'), Kids: context.obj([]) });
  const contactParentRef = context.register(contactParent);
  fieldsArray.push(contactParentRef);
  const contactKids = contactParent.get(PDFName.of('Kids')) as PDFArray;

  function addContactField(fd: Record<string, any>): PDFRef {
    const w = context.obj(fd);
    const r = context.register(w);
    contactKids.push(r);
    annots.push(r);
    return r;
  }

  addContactField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: contactParentRef,
    Ff: 2,
    Rect: context.obj(toNativeRect([36, 304, 285, 326], A4.height)),
    T: PDFString.of('mobile'),
    TU: PDFString.of('Nombor telefon bimbit Malaysia'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 13, P: page.ref,
  });

  // contact.homePhone
  drawText(page, 'Telefon rumah', 310, 294, { size: 10 });
  addContactField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: contactParentRef,
    Rect: context.obj(toNativeRect([310, 304, 559, 326], A4.height)),
    T: PDFString.of('homePhone'),
    TU: PDFString.of('Nombor telefon talian tetap Malaysia'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 12, P: page.ref,
  });

  // Text3 — email (flat, no /TU)
  drawText(page, 'E-mel', 36, 344, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Rect: context.obj(toNativeRect([36, 354, 559, 376], A4.height)),
    T: PDFString.of('Text3'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 80, P: page.ref,
  });

  // contact.address — multiline
  drawText(page, 'Alamat surat-menyurat', 36, 394, { size: 10 });
  addContactField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: contactParentRef,
    Ff: 4098, // Multiline + Required
    Rect: context.obj(toNativeRect([36, 404, 350, 454], A4.height)),
    T: PDFString.of('address'),
    TU: PDFString.of('Alamat seperti yang hendak dicetak'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 160, P: page.ref,
  });

  // contact.postcode
  drawText(page, 'Poskod', 375, 394, { size: 10 });
  addContactField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: contactParentRef,
    Ff: 2,
    Rect: context.obj(toNativeRect([375, 404, 459, 426], A4.height)),
    T: PDFString.of('postcode'),
    TU: PDFString.of('Poskod Malaysia, lima digit'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 5, P: page.ref,
  });

  // contact.city
  drawText(page, 'Bandar', 375, 434, { size: 10 });
  addContactField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: contactParentRef,
    Ff: 2,
    Rect: context.obj(toNativeRect([375, 444, 559, 466], A4.height)),
    T: PDFString.of('city'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 40, P: page.ref,
  });

  // contact.state — dropdown
  drawText(page, 'Negeri / Wilayah', 36, 496, { size: 10 });
  addContactField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Ch'),
    Parent: contactParentRef,
    Ff: 131074, // Combo + Required
    Rect: context.obj(toNativeRect([36, 506, 220, 528], A4.height)),
    T: PDFString.of('state'),
    TU: PDFString.of('Pilih negeri atau wilayah'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    Opt: context.obj([
      context.obj([PDFString.of('SGR'), PDFString.of('Selangor')]),
      context.obj([PDFString.of('KUL'), PDFString.of('Kuala Lumpur')]),
      context.obj([PDFString.of('JHR'), PDFString.of('Johor')]),
      context.obj([PDFString.of('OTH'), PDFString.of('Lain-lain')]),
    ]),
    P: page.ref,
  });

  // --- Visit info section ---
  const visitParent = context.obj({ T: PDFString.of('visit'), Kids: context.obj([]) });
  const visitParentRef = context.register(visitParent);
  fieldsArray.push(visitParentRef);
  const visitKids = visitParent.get(PDFName.of('Kids')) as PDFArray;

  function addVisitField(fd: Record<string, any>): PDFRef {
    const w = context.obj(fd);
    const r = context.register(w);
    visitKids.push(r);
    annots.push(r);
    return r;
  }

  // visit.date
  drawText(page, 'Tarikh lawatan', 245, 496, { size: 10 });
  addVisitField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: visitParentRef,
    Ff: 2,
    Rect: context.obj(toNativeRect([245, 506, 390, 528], A4.height)),
    T: PDFString.of('date'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 10, P: page.ref,
  });

  // visit.firstVisit — checkbox
  drawText(page, 'Lawatan pertama', 438, 504, { size: 10 });
  addVisitField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Btn'),
    Parent: visitParentRef,
    Rect: context.obj(toNativeRect([420, 510, 434, 524], A4.height)),
    T: PDFString.of('firstVisit'),
    TU: PDFString.of('Adakah ini lawatan pertama?'),
    V: PDFName.of('Off'), AS: PDFName.of('Off'),
    AP: context.obj({ N: context.obj({
      Yes: context.register(context.stream('0.5 g\n0 0 12 12 re\nf\n0 g\n2 2 8 8 re\nf')),
      Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')),
    })}),
    P: page.ref,
  });

  // visit.shortCode
  drawText(page, 'Kod ringkas (maksimum 4 aksara)', 350, 694, { size: 10 });
  addVisitField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: visitParentRef,
    Rect: context.obj(toNativeRect([350, 704, 450, 726], A4.height)),
    T: PDFString.of('shortCode'),
    TU: PDFString.of('Kod ringkas, maksimum empat aksara'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 4, P: page.ref,
  });

  // --- Medical info ---
  const medParent = context.obj({ T: PDFString.of('medical'), Kids: context.obj([]) });
  const medParentRef = context.register(medParent);
  fieldsArray.push(medParentRef);
  const medKids = medParent.get(PDFName.of('Kids')) as PDFArray;

  // medical.allergyFlag
  drawText(page, 'Ada alahan', 54, 555, { size: 10 });
  const allergyWidget = context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Btn'),
    Parent: medParentRef,
    Rect: context.obj(toNativeRect([36, 553, 50, 567], A4.height)),
    T: PDFString.of('allergyFlag'),
    V: PDFName.of('Off'), AS: PDFName.of('Off'),
    AP: context.obj({ N: context.obj({
      Yes: context.register(context.stream('0.5 g\n0 0 12 12 re\nf\n0 g\n2 2 8 8 re\nf')),
      Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')),
    })}),
    P: page.ref,
  });
  const allergyRef = context.register(allergyWidget);
  medKids.push(allergyRef);
  annots.push(allergyRef);

  // medical.description — multiline
  drawText(page, 'Sebab lawatan / gejala', 220, 542, { size: 10 });
  const descWidget = context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: medParentRef,
    Ff: 4096, // Multiline
    Rect: context.obj(toNativeRect([220, 552, 559, 610], A4.height)),
    T: PDFString.of('description'),
    TU: PDFString.of('Terangkan sebab lawatan atau gejala'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 180, P: page.ref,
  });
  const descRef = context.register(descWidget);
  medKids.push(descRef);
  annots.push(descRef);

  // --- Emergency contact ---
  const emergParent = context.obj({ T: PDFString.of('emergency'), Kids: context.obj([]) });
  const emergParentRef = context.register(emergParent);
  fieldsArray.push(emergParentRef);
  const emergKids = emergParent.get(PDFName.of('Kids')) as PDFArray;

  function addEmergField(fd: Record<string, any>): PDFRef {
    const w = context.obj(fd);
    const r = context.register(w);
    emergKids.push(r);
    annots.push(r);
    return r;
  }

  drawText(page, 'Nama untuk dihubungi semasa kecemasan', 36, 644, { size: 10 });
  addEmergField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: emergParentRef,
    Rect: context.obj(toNativeRect([36, 654, 285, 676], A4.height)),
    T: PDFString.of('name'),
    TU: PDFString.of('Nama orang untuk dihubungi semasa kecemasan'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 70, P: page.ref,
  });

  drawText(page, 'Telefon kecemasan', 310, 644, { size: 10 });
  addEmergField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Parent: emergParentRef,
    Rect: context.obj(toNativeRect([310, 654, 559, 676], A4.height)),
    T: PDFString.of('phone'),
    TU: PDFString.of('Nombor telefon kecemasan Malaysia'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 13, P: page.ref,
  });

  // --- Consent section ---
  const consentParent = context.obj({ T: PDFString.of('consent'), Kids: context.obj([]) });
  const consentParentRef = context.register(consentParent);
  fieldsArray.push(consentParentRef);
  const consentKids = consentParent.get(PDFName.of('Kids')) as PDFArray;

  // consent.contact — initially checked
  drawText(page, 'Saya bersetuju untuk dihubungi', 54, 706, { size: 10 });
  const consentContactWidget = context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Btn'),
    Parent: consentParentRef,
    Rect: context.obj(toNativeRect([36, 704, 50, 718], A4.height)),
    T: PDFString.of('contact'),
    TU: PDFString.of('Persetujuan untuk dihubungi'),
    V: PDFName.of('Yes'), AS: PDFName.of('Yes'),
    AP: context.obj({ N: context.obj({
      Yes: context.register(context.stream('0.5 g\n0 0 12 12 re\nf\n0 g\n2 2 8 8 re\nf')),
      Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')),
    })}),
    P: page.ref,
  });
  const consentContactRef = context.register(consentContactWidget);
  consentKids.push(consentContactRef);
  annots.push(consentContactRef);

  // consent.signature
  drawText(page, 'Tandatangan pesakit', 36, 752, { size: 10 });
  drawText(page, 'Tandatangan selepas dicetak', 36, 766, { size: 9, color: [0.4, 0.4, 0.4] });
  const consentSigRectNative = toNativeRect([36, 762, 300, 800], A4.height);
  const consentSigWidget = makeSigField(pdfDoc, 'signature', consentSigRectNative, page.ref, false);
  consentSigWidget.set(PDFName.of('Parent'), consentParentRef);
  const consentSigRef = context.register(consentSigWidget);
  consentKids.push(consentSigRef);
  annots.push(consentSigRef);

  page.node.set(PDFName.of('Annots'), context.obj(annots));
  const fieldsRef = context.register(fieldsArray);
  const acroForm = context.obj({ Fields: fieldsRef });
  pdfDoc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'clinic-registration.pdf'), bytes);
  console.log('Created: clinic-registration.pdf (22 logical fields)');
}

// ---------------------------------------------------------------------------
// Fixture 3: us-community-clinic.pdf
// ---------------------------------------------------------------------------

async function createUsClinicPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([LETTER.width, LETTER.height]);

  drawText(page, 'Paper Lantern Fictional Community Clinic', 36, 56, { size: 12, color: [0.3, 0.3, 0.3] });
  drawText(page, 'Community Clinic Intake', 36, 74, { size: 18 });
  drawText(page, 'SYNTHETIC TEST FORM — fictional organisation and fictional information only.', 36, 94, { size: 9, color: [0.5, 0, 0] });

  // Section headings
  drawText(page, 'Patient', 36, 112, { size: 12 });
  drawText(page, 'Contact', 36, 306, { size: 12 });
  drawText(page, 'Visit', 36, 495, { size: 12 });
  drawText(page, 'Declaration', 36, 640, { size: 12 });

  const context = pdfDoc.context;
  const fieldsArray = context.obj([]) as PDFArray;
  const annots: PDFRef[] = [];

  function addField(fd: Record<string, any>): PDFRef {
    const w = context.obj(fd);
    const r = context.register(w);
    fieldsArray.push(r);
    annots.push(r);
    return r;
  }

  // patient.fullName
  drawText(page, 'Full name', 36, 122, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2, // Required
    Rect: context.obj(toNativeRect([36, 132, 576, 156], LETTER.height)),
    T: PDFString.of('patient.fullName'),
    TU: PDFString.of('Name exactly as it should appear on the form'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 70, P: page.ref,
  });

  // patient.birthDate
  drawText(page, 'Date of birth (MM/DD/YYYY)', 36, 192, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2,
    Rect: context.obj(toNativeRect([36, 202, 270, 226], LETTER.height)),
    T: PDFString.of('patient.birthDate'),
    TU: PDFString.of('Date of birth, MM/DD/YYYY'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 10, P: page.ref,
  });

  // Text1 — SSN
  drawText(page, 'Social Security number (NNN-NN-NNNN)', 306, 192, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Rect: context.obj(toNativeRect([306, 202, 576, 226], LETTER.height)),
    T: PDFString.of('Text1'),
    TU: PDFString.of('Format check only; not identity verification'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 11, P: page.ref,
  });

  // contact.phone
  drawText(page, 'US phone number', 36, 316, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2,
    Rect: context.obj(toNativeRect([36, 326, 270, 350], LETTER.height)),
    T: PDFString.of('contact.phone'),
    TU: PDFString.of('US phone number; country code +1 accepted'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 14, P: page.ref,
  });

  // Text7 — ZIP code
  drawText(page, 'ZIP code', 306, 316, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2,
    Rect: context.obj(toNativeRect([306, 326, 456, 350], LETTER.height)),
    T: PDFString.of('Text7'),
    TU: PDFString.of('ZIP or ZIP+4'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 10, P: page.ref,
  });

  // contact.email
  drawText(page, 'Email address', 36, 386, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Rect: context.obj(toNativeRect([36, 396, 576, 420], LETTER.height)),
    T: PDFString.of('contact.email'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 80, P: page.ref,
  });

  // contact.address — multiline
  drawText(page, 'Mailing address', 36, 440, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 4098, // Multiline + Required
    Rect: context.obj(toNativeRect([36, 450, 330, 500], LETTER.height)),
    T: PDFString.of('contact.address'),
    TU: PDFString.of('Address exactly as it should appear on the form'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 160, P: page.ref,
  });

  // contact.city
  drawText(page, 'City', 354, 440, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2,
    Rect: context.obj(toNativeRect([354, 450, 576, 474], LETTER.height)),
    T: PDFString.of('contact.city'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 40, P: page.ref,
  });

  // contact.state — dropdown
  drawText(page, 'State', 354, 500, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Ch'),
    Ff: 131074, // Combo + Required
    Rect: context.obj(toNativeRect([354, 510, 576, 534], LETTER.height)),
    T: PDFString.of('contact.state'),
    TU: PDFString.of('Select a state'),
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    Opt: context.obj([
      context.obj([PDFString.of('CA'), PDFString.of('California')]),
      context.obj([PDFString.of('NY'), PDFString.of('New York')]),
      context.obj([PDFString.of('TX'), PDFString.of('Texas')]),
    ]),
    P: page.ref,
  });

  // visit.date
  drawText(page, 'Visit date (MM/DD/YYYY)', 36, 538, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 2,
    Rect: context.obj(toNativeRect([36, 548, 220, 572], LETTER.height)),
    T: PDFString.of('visit.date'),
    TU: PDFString.of('Visit date, MM/DD/YYYY'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 10, P: page.ref,
  });

  // visit.contactMethod — radio
  drawText(page, 'Preferred contact method', 270, 542, { size: 10 });
  drawText(page, 'Phone', 286, 558, { size: 10 });
  drawText(page, 'Email', 391, 558, { size: 10 });
  drawText(page, 'Neither', 491, 558, { size: 10 });
  const contactMethodParent = context.obj({
    FT: PDFName.of('Btn'), Ff: 32768,
    T: PDFString.of('visit.contactMethod'),
    TU: PDFString.of('Select one contact method'),
    Kids: context.obj([]),
  });
  const contactMethodRef = context.register(contactMethodParent);
  fieldsArray.push(contactMethodRef);
  const methodKids = contactMethodParent.get(PDFName.of('Kids')) as PDFArray;
  for (const [xLeft, exportVal] of [[270, 'P'], [375, 'E'], [475, 'N']] as [number, string][]) {
    const w = context.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'),
      Parent: contactMethodRef,
      Rect: context.obj(toNativeRect([xLeft, 552, xLeft + 14, 566], LETTER.height)),
      AS: PDFName.of('Off'),
      AP: context.obj({ N: context.obj({
        [exportVal]: context.register(context.stream('0 g\n3 3 6 6 re\nf')),
        Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')),
      })}),
      P: page.ref,
    });
    const wRef = context.register(w);
    methodKids.push(wRef);
    annots.push(wRef);
  }

  // visit.reason — multiline
  drawText(page, 'Reason for visit', 36, 660, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    Ff: 4096, // Multiline
    Rect: context.obj(toNativeRect([36, 670, 330, 732], LETTER.height)),
    T: PDFString.of('visit.reason'),
    TU: PDFString.of('Describe the reason for your visit'),
    DA: PDFString.of('/Helv 10 Tf 0 g'), MaxLen: 180, P: page.ref,
  });

  // consent.reminders — checkbox
  drawText(page, 'I agree to appointment reminders', 368, 668, { size: 10 });
  addField({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Btn'),
    Rect: context.obj(toNativeRect([354, 676, 368, 690], LETTER.height)),
    T: PDFString.of('consent.reminders'),
    V: PDFName.of('Off'), AS: PDFName.of('Off'),
    AP: context.obj({ N: context.obj({
      Yes: context.register(context.stream('0.5 g\n0 0 12 12 re\nf\n0 g\n2 2 8 8 re\nf')),
      Off: context.register(context.stream('0 g\n0 0 12 12 re\nS')),
    })}),
    P: page.ref,
  });

  // consent.signature
  drawText(page, 'Patient signature', 354, 708, { size: 10 });
  drawText(page, 'Sign after printing', 354, 722, { size: 9, color: [0.4, 0.4, 0.4] });
  const usSigRectNative = toNativeRect([354, 718, 576, 756], LETTER.height);
  const usSigWidget = makeSigField(pdfDoc, 'consent.signature', usSigRectNative, page.ref, false);
  const usSigRef = context.register(usSigWidget);
  fieldsArray.push(usSigRef);
  annots.push(usSigRef);

  page.node.set(PDFName.of('Annots'), context.obj(annots));
  const fieldsRef = context.register(fieldsArray);
  const acroForm = context.obj({ Fields: fieldsRef });
  pdfDoc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'us-community-clinic.pdf'), bytes);
  console.log('Created: us-community-clinic.pdf (14 logical fields)');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  await createNoFieldsPdf();
  await createXfaAcroformPdf();
  await createSigEmptyPdf();
  await createSigPopulatedPdf();
  await createPrefilledFieldPdf();
  await createSchoolEnrolmentPdf();
  await createClinicRegistrationPdf();
  await createUsClinicPdf();

  console.log('\nAll fixtures created successfully.');
}

main().catch((err) => {
  console.error('Error creating fixtures:', err);
  process.exit(1);
});
