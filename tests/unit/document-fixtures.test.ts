/**
 * tests/unit/document-fixtures.test.ts
 *
 * The committed document fixtures (formbridge-any-document task 3.1). The
 * byte-for-byte comparison with a fresh render needs Chromium, so it runs as
 * `npx tsx scripts/create-fixtures/documents.ts --check`; this test checks
 * what can be checked without a browser: every listed file exists, the
 * signatures match the kind, the mock OCR results agree with the form data,
 * every canary is really printed and never expected to be preselected, and
 * no fixture text names a person outside the synthetic word list.
 * Validates: Requirements 24.12, 24.13, 25.1
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CJK_TAMIL,
  DEFAULT_SELECTION,
  IMAGE_FORMS,
  INJECTION_LABELS,
  INJECTION_LABELS_PLAIN,
  PREFILLED_SENSITIVE,
  PREFILLED_SPLIT,
  printedLines,
} from '../../scripts/create-fixtures/document-forms.js';
import { INJECTION_CASES } from '../fixtures/document/injection-strings.js';

const DIR = path.join('fixtures', 'documents');

interface Expected {
  fixtures: Array<{
    file: string;
    kind: string;
    lang?: string;
    exifOrientation?: number;
    pages?: Array<{ textSource: string; mock?: { width: number; height: number; simulated?: boolean; lines: Array<{ text: string; confidence: number; box: { left: number; top: number; right: number; bottom: number } }> } }>;
    lines?: Array<{ page: number; text: string; expect: string }>;
    canaries?: Array<{ value: string; state: string }>;
  }>;
}

const expected = JSON.parse(readFileSync(path.join(DIR, 'expected.json'), 'utf8')) as Expected;
const bytes = (file: string) => new Uint8Array(readFileSync(path.join(DIR, file)));
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

describe('document fixtures', () => {
  it('lists every file in the folder, and every listed file exists', () => {
    const onDisk = readdirSync(DIR).filter((f) => f !== 'expected.json').sort();
    expect(expected.fixtures.map((f) => f.file).sort()).toEqual(onDisk);
    expect(onDisk.length).toBe(31);
  });

  it('expected.json holds ASCII only (non-Latin text is escaped)', () => {
    expect(readFileSync(path.join(DIR, 'expected.json'), 'utf8')).toMatch(/^[\x00-\x7f]*$/);
  });

  it.each(expected.fixtures.filter((f) => f.kind !== 'unknown').map((f) => [f.file, f.kind] as const))('%s starts with the signature of %s', (file, kind) => {
    const b = bytes(file);
    if (kind === 'jpeg' || kind === 'probe') expect(startsWith(b, [0xff, 0xd8, 0xff])).toBe(true);
    if (kind === 'png') expect(startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).toBe(true);
    if (kind === 'pdf-without-fields') expect(new TextDecoder().decode(b.subarray(0, 5))).toBe('%PDF-');
    if (file.endsWith('.rtf')) expect(new TextDecoder().decode(b.subarray(0, 5))).toBe('{\\rtf');
    if (file.endsWith('.doc')) expect(startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])).toBe(true);
  });

  it('the empty file is empty and the truncated files are shorter than their sources', () => {
    expect(bytes('empty.bin').length).toBe(0);
    expect(bytes('truncated.jpg').length).toBeLessThan(bytes('clean-en.jpg').length);
    expect(bytes('truncated.png').length).toBeLessThan(bytes('clean-en.png').length);
    expect(bytes('truncated.pdf').length).toBeLessThan(bytes('mixed-text-and-scan.pdf').length);
  });

  it('the tagged rotated photo carries EXIF orientation 6 and the untagged one carries none', () => {
    const tagged = bytes('rotated-exif6.jpg');
    const untagged = bytes('rotated-untagged.jpg');
    const hasExif = (b: Uint8Array) => b[2] === 0xff && b[3] === 0xe1 && new TextDecoder().decode(b.subarray(6, 10)) === 'Exif';
    expect(hasExif(tagged)).toBe(true);
    expect(hasExif(untagged)).toBe(false);
    // Orientation value inside the one IFD entry (offset 4 + 6 Exif header + 18 into TIFF).
    expect(tagged[4 + 2 + 6 + 18]).toBe(6);
    expect(tagged.length - untagged.length).toBe(tagged[4]! * 256 + tagged[5]! + 2);
  });

  it.each(IMAGE_FORMS.map((f) => [f.name, f] as const))('%s: the mock OCR result reads exactly the printed lines', (name, form) => {
    const entry = expected.fixtures.find((f) => f.file === `${name}.png`)!;
    const mock = entry.pages![0]!.mock!;
    const printed = printedLines(form).map((l) => l.text);
    expect(mock.lines.map((l) => l.text).sort()).toEqual([...printed].sort());
    for (const l of mock.lines) {
      expect(l.box.left).toBeGreaterThanOrEqual(0);
      expect(l.box.top).toBeGreaterThanOrEqual(0);
      expect(l.box.right).toBeLessThanOrEqual(mock.width);
      expect(l.box.bottom).toBeLessThanOrEqual(mock.height);
      expect(l.box.right).toBeGreaterThan(l.box.left);
    }
  });

  it('every canary is printed on its fixture and is never expected to start selected', () => {
    const forms = [PREFILLED_SENSITIVE, PREFILLED_SPLIT, ...DEFAULT_SELECTION];
    for (const form of forms) {
      expect(form.canaries.length).toBeGreaterThan(0);
      const lines = printedLines(form);
      for (const c of form.canaries) {
        expect(['unselected', 'not-listed']).toContain(c.state);
        const digits = c.value.replace(/\D/g, '');
        // Split values are printed in parts, so check the digits across the page; others are printed whole.
        if (form === PREFILLED_SPLIT) {
          if (/^\d+$/.test(c.value) && !c.where.includes('CJK')) {
            const all = lines.map((l) => l.text.replace(/O/g, '0').replace(/S/g, '5').replace(/l/g, '1')).join(' ').replace(/\D/g, '');
            expect(all).toContain(digits.slice(0, 6));
          }
        } else {
          const holder = lines.filter((l) => l.text.includes(c.value));
          expect(holder.length, `${form.name}: ${c.value}`).toBeGreaterThan(0);
          for (const l of holder) expect(l.expect, `${form.name}: ${l.text}`).not.toBe('selected');
        }
      }
    }
  });

  it('the injection form prints every attack, and its plain twin has the same line lengths', () => {
    const attack = printedLines(INJECTION_LABELS).map((l) => l.text);
    const plain = printedLines(INJECTION_LABELS_PLAIN).map((l) => l.text);
    for (const c of INJECTION_CASES) for (const part of c.attack.split('\n')) expect(attack.some((l) => l.includes(part.replace(/:$/, '')))).toBe(true);
    expect(plain.map((l) => l.length)).toEqual(attack.map((l) => l.length));
  });

  it('the glary mock is marked as simulated and has low confidence; the clean mocks do not', () => {
    const glary = expected.fixtures.find((f) => f.file === 'glary.jpg')!.pages![0]!.mock!;
    expect(glary.simulated).toBe(true);
    expect(Math.max(...glary.lines.map((l) => l.confidence))).toBeLessThan(0.6);
    const clean = expected.fixtures.find((f) => f.file === 'clean-en.png')!.pages![0]!.mock!;
    expect(clean.simulated).toBeUndefined();
  });

  it('the mixed PDF lists text, scan, text pages and the six-page PDF lists six pages', () => {
    expect(expected.fixtures.find((f) => f.file === 'mixed-text-and-scan.pdf')!.pages!.map((p) => p.textSource)).toEqual(['text-layer', 'ocr', 'text-layer']);
    expect(expected.fixtures.find((f) => f.file === 'six-pages.pdf')!.pages).toHaveLength(6);
  });

  it('the CJK and Tamil samples are present with their language tags', () => {
    for (const form of CJK_TAMIL) {
      const entry = expected.fixtures.find((f) => f.file === `${form.name}.png`)!;
      expect(entry.lang).toBe(form.lang);
      expect(existsSync(path.join(DIR, entry.file))).toBe(true);
    }
  });

  it('no Latin fixture text names a person outside the synthetic word list', () => {
    // Capitalised words that are not label vocabulary must be synthetic: "Zqx..." words or the fixed fictional list.
    const allowedNames = /^(Zqx\w*|ZQX\w*|KAPPA|Aminah|Ali|Tan|Lim|Wong|Jalan|Taman|Melati|Kajang|Selangor|binti)$/;
    const vocabulary = new Set(
      'Community Clinic Registration Please Full IC Date Phone Email Home Postcode Reason Signature Sample Not Borang Pendaftaran Klinik Komuniti Sila Nama No Tarikh E-mel Alamat Poskod Sebab Tandatangan Bukan Patient Name Occupation SSN Tel Declaration DD MM YYYY HH BB TTTT'.split(' '),
    );
    for (const form of IMAGE_FORMS.filter((f) => f.font === 'latin' && !f.name.startsWith('injection'))) {
      for (const l of printedLines(form)) {
        for (const word of l.text.match(/\b[A-Z][a-zA-Z-]+\b/g) ?? []) {
          if (vocabulary.has(word)) continue;
          expect(word, `${form.name}: "${l.text}"`).toMatch(allowedNames);
        }
      }
    }
  });
});
