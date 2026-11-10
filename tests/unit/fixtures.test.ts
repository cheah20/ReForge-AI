/**
 * tests/unit/fixtures.test.ts
 *
 * Review items 17 and 18: fixture rectangles follow the fixture specification,
 * the Latin fixtures embed Noto Sans (with the accented letters the US answers
 * need), and the generator is reproducible, so the committed files are exactly
 * what the script produces.
 * Validates: Requirements 14.1, 14.2, 14.9
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildFixtures, loadFixtureFont } from '../../scripts/create-fixtures/create-fixtures.js';
import { extractFields } from '../../src/lib/pdf-extract/index.js';

const committed = (name: string) => new Uint8Array(readFileSync(path.join('fixtures', name)));

describe('generator', () => {
  it('is reproducible and matches the committed fixtures byte for byte', async () => {
    const first = await buildFixtures();
    const second = await buildFixtures();
    expect([...first.keys()].sort()).toEqual([...second.keys()].sort());
    for (const [name, bytes] of first) {
      expect(Buffer.from(second.get(name)!).equals(Buffer.from(bytes)), `${name} differs between runs`).toBe(true);
      expect(Buffer.from(committed(name)).equals(Buffer.from(bytes)), `${name} is stale: regenerate fixtures`).toBe(true);
    }
  }, 60_000);
});

describe('school-enrolment.pdf rectangles (fixture spec section 2)', () => {
  // Top-origin [left, top, right, bottom] copied from the specification table.
  const SPEC: Record<string, [number, number, number, number][]> = {
    'student.name': [[36, 140, 559, 164]],
    Text1: [[36, 210, 250, 234]],
    'guardian.email': [[285, 210, 559, 234]],
    'student.notes': [[36, 285, 559, 365]],
    'admission.session': [
      [36, 450, 50, 464],
      [285, 450, 299, 464],
    ],
    'admission.year': [[36, 520, 270, 544]],
    Text7: [[310, 520, 559, 592]],
    'consent.trip': [[36, 620, 50, 634]],
    'office.code': [[36, 690, 250, 714]],
    'consent.signature': [[285, 690, 559, 748]],
  };

  it('places every widget where the spec says', async () => {
    const r = await extractFields(committed('school-enrolment.pdf'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.map((f) => f.fieldId).sort()).toEqual(Object.keys(SPEC).sort());
    for (const f of r.fields) {
      const got = f.widgets.map((w) => [w.bbox.left, w.bbox.top, w.bbox.right, w.bbox.bottom].map((v) => Math.round(v * 100) / 100));
      expect(got, f.fieldId).toEqual(SPEC[f.fieldId]);
    }
  });

  it('marks the session radio as required', async () => {
    const r = await extractFields(committed('school-enrolment.pdf'));
    expect(r.ok && r.fields.find((f) => f.fieldId === 'admission.session')?.required).toBe(true);
  });
});

describe('embedded Noto Sans (fixture spec common conventions)', () => {
  const LATIN = [
    'clinic-registration.pdf',
    'school-enrolment.pdf',
    'us-community-clinic.pdf',
    'prefilled-field.pdf',
    'no-fields.pdf',
    'xfa-acroform.pdf',
    'sig-empty.pdf',
    'sig-populated.pdf',
  ];

  it.each(LATIN)('%s uses an embedded Noto Sans font for page text', async (name) => {
    const doc = await PDFDocument.load(committed(name), { updateMetadata: false });
    const fonts = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    expect(fonts).toBeDefined();
    const baseFonts = fonts!.keys().map((k) => {
      const font = fonts!.lookup(k, PDFDict);
      return String(font.lookup(PDFName.of('BaseFont')));
    });
    expect(baseFonts.length).toBeGreaterThan(0);
    for (const bf of baseFonts) expect(bf).toMatch(/NotoSans/);
  });

  it('the embedded font covers the accented letters of the US answers', () => {
    const font = fontkit.create(Buffer.from(loadFixtureFont()));
    for (const ch of 'ÍÉÑíéñáóúü') {
      expect(font.hasGlyphForCodePoint(ch.codePointAt(0)!), ch).toBe(true);
    }
  });

  it('the AcroForm default resources name the embedded font', async () => {
    const doc = await PDFDocument.load(committed('us-community-clinic.pdf'), { updateMetadata: false });
    const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    const dr = acroForm.lookup(PDFName.of('DR'), PDFDict);
    const font = dr.lookup(PDFName.of('Font'), PDFDict).lookup(PDFName.of('NotoSans'), PDFDict);
    expect(String(font.lookup(PDFName.of('BaseFont')))).toMatch(/NotoSans/);
  });
});
