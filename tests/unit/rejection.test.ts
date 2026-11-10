/**
 * tests/unit/rejection.test.ts
 *
 * Task 8.3 and review items 1, 2, 4 and 8: every rejection code, the exact
 * 10 MiB boundary, logical-field counting, the single signature rule, empty XFA
 * and malformed structures that must not throw.
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { checkPdf, MAX_FILE_SIZE_BYTES } from '../../src/lib/pdf-extract/rejection.js';
import { FormBuilder } from '../helpers/pdf-builder.js';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join('fixtures', name)));

async function codeOf(bytes: Uint8Array): Promise<string> {
  const r = await checkPdf(bytes);
  return r.rejected ? r.code : 'ACCEPTED';
}

/** Pad a valid PDF with trailing spaces to an exact byte length. */
function padTo(bytes: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.fill(0x20);
  out.set(bytes, 0);
  return out;
}

describe('fixtures', () => {
  it.each([
    ['clinic-registration.pdf', 'ACCEPTED'],
    ['school-enrolment.pdf', 'ACCEPTED'],
    ['us-community-clinic.pdf', 'ACCEPTED'],
    ['prefilled-field.pdf', 'ACCEPTED'],
    ['sig-empty.pdf', 'ACCEPTED'],
    ['sig-populated.pdf', 'SIGNED'],
    ['xfa-acroform.pdf', 'XFA'],
    ['no-fields.pdf', 'NO_FIELDS'],
  ])('%s -> %s', async (name, expected) => {
    expect(await codeOf(fixture(name))).toBe(expected);
  });

  it('encrypted.pdf (qpdf AES-256) -> ENCRYPTED', async () => {
    const bytes = fixture('encrypted.pdf');
    // The fixture really is encrypted: the trailer names an /Encrypt dictionary.
    expect(Buffer.from(bytes).toString('latin1')).toMatch(/\/Encrypt\s+\d+\s+\d+\s+R/);
    expect(await codeOf(bytes)).toBe('ENCRYPTED');
  });

  it('encrypted.pdf is rejected by extractFields before any field is read', async () => {
    const { extractFields } = await import('../../src/lib/pdf-extract/index.js');
    let textLoaded = false;
    const r = await extractFields(fixture('encrypted.pdf'), {
      loadPageText: async () => {
        textLoaded = true;
        return new Map();
      },
    });
    expect(r).toEqual({ ok: false, code: 'ENCRYPTED', messageKey: 'upload.error.encrypted' });
    expect(textLoaded).toBe(false);
  });
});

describe('size limit (decision 7: 10,485,760 bytes)', () => {
  it('accepts a valid PDF of exactly the limit', async () => {
    const padded = padTo(fixture('sig-empty.pdf'), MAX_FILE_SIZE_BYTES);
    expect(padded.byteLength).toBe(10_485_760);
    expect(await codeOf(padded)).toBe('ACCEPTED');
  });

  it('rejects one byte over the limit before parsing', async () => {
    const padded = padTo(fixture('sig-empty.pdf'), MAX_FILE_SIZE_BYTES + 1);
    expect(await codeOf(padded)).toBe('TOO_LARGE');
  });
});

describe('invalid and encrypted input', () => {
  it('rejects non-PDF bytes as INVALID_PDF', async () => {
    const bytes = new TextEncoder().encode('This is a plain text file, not a PDF.');
    expect(await codeOf(bytes)).toBe('INVALID_PDF');
  });

  it('rejects an empty buffer as INVALID_PDF', async () => {
    expect(await codeOf(new Uint8Array(0))).toBe('INVALID_PDF');
  });

  it('rejects a document whose trailer has /Encrypt', async () => {
    const b = await FormBuilder.create();
    b.textField('probe.name', [36, 700, 300, 726]);
    const doc = await PDFDocument.load(await b.save());
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: PDFName.of('Standard') }));
    expect(await codeOf(await doc.save())).toBe('ENCRYPTED');
  });
});

describe('page limit', () => {
  async function withPages(n: number) {
    const b = await FormBuilder.create(n);
    b.textField('probe.name', [36, 700, 300, 726]);
    return b.save();
  }
  it('accepts 20 pages', async () => expect(await codeOf(await withPages(20))).toBe('ACCEPTED'));
  it('rejects 21 pages', async () => expect(await codeOf(await withPages(21))).toBe('TOO_MANY_PAGES'));
});

describe('logical field counting (review item 1)', () => {
  async function withTextFields(n: number) {
    const b = await FormBuilder.create();
    for (let i = 0; i < n; i++) b.textField(`f${i}`, [36, 10 + i, 300, 11 + i]);
    return b.save();
  }

  it('accepts 150 fields', async () => expect(await codeOf(await withTextFields(150))).toBe('ACCEPTED'));
  it('rejects 151 fields', async () => expect(await codeOf(await withTextFields(151))).toBe('TOO_MANY_FIELDS'));

  it('counts a radio group with 160 widgets as one field', async () => {
    const b = await FormBuilder.create();
    const group = b.node({ FT: PDFName.of('Btn'), Ff: 32768, T: PDFString.of('choice') }, true);
    const kids = Array.from({ length: 160 }, (_, i) => b.widget([10, 10 + i, 20, 11 + i], { parent: group.ref }).ref);
    b.setKids(group.dict, kids);
    expect(await codeOf(await b.save())).toBe('ACCEPTED');
  });

  it('counts named kids whose /FT is only on the parent', async () => {
    const b = await FormBuilder.create();
    const parent = b.node({ FT: PDFName.of('Tx'), T: PDFString.of('contact') }, true);
    const kids = ['city', 'state'].map((t, i) => {
      const k = b.node({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Widget'),
        T: PDFString.of(t),
        Parent: parent.ref,
        Rect: b.ctx.obj([36, 700 - i * 40, 300, 720 - i * 40]),
      });
      b.annotate(k.ref);
      return k.ref;
    });
    b.setKids(parent.dict, kids);
    expect(await codeOf(await b.save())).toBe('ACCEPTED');
  });

  it('does not count pushbuttons: a form with only a pushbutton has no fields', async () => {
    const b = await FormBuilder.create();
    b.textField('submit', [36, 700, 120, 726], { FT: PDFName.of('Btn'), Ff: 65536 });
    expect(await codeOf(await b.save())).toBe('NO_FIELDS');
  });
});

describe('signature rule (review item 4)', () => {
  async function withSigValue(value: 'none' | 'minimal' | 'inherited') {
    const b = await FormBuilder.create();
    b.textField('probe.name', [36, 700, 300, 726]);
    const sigDict = b.ctx.register(b.ctx.obj({ Type: PDFName.of('Sig') }));
    if (value === 'inherited') {
      const parent = b.node({ FT: PDFName.of('Sig'), T: PDFString.of('sig'), V: sigDict }, true);
      b.setKids(parent.dict, [b.widget([36, 600, 300, 650], { parent: parent.ref }).ref]);
    } else {
      b.textField('sig', [36, 600, 300, 650], {
        FT: PDFName.of('Sig'),
        ...(value === 'minimal' ? { V: sigDict } : {}),
      });
    }
    return b.save();
  }

  it('accepts an empty signature field', async () => expect(await codeOf(await withSigValue('none'))).toBe('ACCEPTED'));
  it('rejects /V << /Type /Sig >> with no other keys', async () =>
    expect(await codeOf(await withSigValue('minimal'))).toBe('SIGNED'));
  it('rejects a /V inherited from the parent field', async () =>
    expect(await codeOf(await withSigValue('inherited'))).toBe('SIGNED'));
});

describe('XFA detection (review item 8)', () => {
  async function withXfa(kind: 'empty-stream' | 'empty-array' | 'stream') {
    const b = await FormBuilder.create();
    b.textField('probe.name', [36, 700, 300, 726]);
    const xfa =
      kind === 'empty-array'
        ? b.ctx.obj([])
        : b.ctx.register(b.ctx.stream(kind === 'stream' ? '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>' : ''));
    b.acroForm.set(PDFName.of('XFA'), xfa);
    return b.save();
  }

  it('treats a zero-byte /XFA stream as not XFA', async () =>
    expect(await codeOf(await withXfa('empty-stream'))).toBe('ACCEPTED'));
  it('treats an empty /XFA array as not XFA', async () =>
    expect(await codeOf(await withXfa('empty-array'))).toBe('ACCEPTED'));
  it('rejects a non-empty /XFA stream', async () => expect(await codeOf(await withXfa('stream'))).toBe('XFA'));
});

describe('malformed structures never throw (review item 2)', () => {
  it('handles /Kids of the wrong type', async () => {
    const b = await FormBuilder.create();
    b.textField('ok', [36, 700, 300, 726]);
    b.node({ FT: PDFName.of('Tx'), T: PDFString.of('bad'), Kids: PDFNumber.of(5) }, true);
    await expect(checkPdf(await b.save())).resolves.toMatchObject({ rejected: false });
  });

  it('handles cyclic /Kids', async () => {
    const b = await FormBuilder.create();
    b.textField('ok', [36, 700, 300, 726]);
    const a = b.node({ T: PDFString.of('a') }, true);
    const c = b.node({ T: PDFString.of('c'), FT: PDFName.of('Tx'), Parent: a.ref });
    b.setKids(a.dict, [c.ref]);
    b.setKids(c.dict, [a.ref]);
    await expect(checkPdf(await b.save())).resolves.toMatchObject({ rejected: false });
  });

  it('handles /Rect containing a string', async () => {
    const b = await FormBuilder.create();
    b.textField('bad', [36, 700, 300, 726]).dict.set(
      PDFName.of('Rect'),
      b.ctx.obj([PDFString.of('x'), 1, 2, 3]),
    );
    await expect(checkPdf(await b.save())).resolves.toMatchObject({ rejected: false });
  });
});
