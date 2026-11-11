/**
 * tests/e2e/pdf-check.spec.ts
 *
 * The task 36.2 text-box check must be able to fail: a value drawn outside its
 * field, a value not drawn at all, and a correct fill are told apart.
 * Validates: Requirement 15.2 (step 8)
 */

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFArray } from 'pdf-lib';
import { fillPdf } from '../../src/lib/pdf-fill/index.js';
import { expectTextInsideFields } from './pdf-check.js';

async function filledClinic(): Promise<Uint8Array> {
  const pdf = new Uint8Array(await readFile('fixtures/clinic-registration.pdf'));
  const font = { id: 'noto-latin', bytes: new Uint8Array(await readFile('public/fonts/NotoSans-Regular.ttf')) };
  return fillPdf(pdf, new Map([['patient.fullName', { kind: 'text', value: 'LIN MEI TEST' }]]), [font]);
}

test('passes for a correct fill', async () => {
  expect(await expectTextInsideFields(await filledClinic(), { 'patient.fullName': 'LIN MEI TEST' })).toBe(1);
});

test('fails when the drawn value lies outside its field', async () => {
  const doc = await PDFDocument.load(await filledClinic());
  const widget = doc.getForm().getTextField('patient.fullName').acroField.getWidgets()[0]!;
  const ap = widget.dict.lookup(PDFName.of('AP'), PDFDict);
  const stream = ap.lookup(PDFName.of('N')) as unknown as { dict: PDFDict };
  // Move the appearance 300pt down inside its own coordinates, out of the field box.
  stream.dict.set(PDFName.of('Matrix'), doc.context.obj([1, 0, 0, 1, 0, -300].map((v) => PDFNumber.of(v))) as PDFArray);
  const moved = await doc.save();
  await expect(expectTextInsideFields(moved, { 'patient.fullName': 'LIN MEI TEST' })).rejects.toThrow(/is drawn inside patient.fullName/);
});

test('fails when the value is not drawn at all', async () => {
  const pdf = new Uint8Array(await readFile('fixtures/clinic-registration.pdf'));
  await expect(expectTextInsideFields(pdf, { 'patient.fullName': 'LIN MEI TEST' })).rejects.toThrow(/is drawn on the page/);
});
