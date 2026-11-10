/**
 * tests/unit/extraction-review2.test.ts
 *
 * Review 2 findings, each with a test that fails on the previous code:
 * 1. privacy guards come from every widget on the page,
 * 2. duplicate field nodes cannot hide a signed document,
 * 3. field names longer than 256 characters,
 * 5. stronger structural tests (named kids, inherited signature /V, schema edge cases),
 * plus the empty-choice-export decision.
 * Validates: Requirements 1.3, 4.1, 4.5, 11.1
 */

import { describe, it, expect } from 'vitest';
import { PDFName, PDFString } from 'pdf-lib';
import { extractFields, pageGuardRects } from '../../src/lib/pdf-extract/index.js';
import { checkPdf } from '../../src/lib/pdf-extract/rejection.js';
import { classifyField, needsAnalysis } from '../../src/lib/analysis/reconcile.js';
import { FieldEvidenceSchema } from '../../src/shared/schemas.js';
import type { FieldEvidence } from '../../src/shared/types.js';
import { FormBuilder, type Rect } from '../helpers/pdf-builder.js';

async function evidence(b: FormBuilder): Promise<FieldEvidence[]> {
  const r = await extractFields(await b.save());
  if (!r.ok) throw new Error(`rejected: ${r.code}`);
  return r.fields;
}

const CANARY = 'GUARD_CANARY_8K3';

/** A form with one ordinary field and a labelled snippet, plus `setup` adding the guarded widget. */
async function guardCase(setup: (b: FormBuilder) => Rect | Promise<Rect>) {
  const b = await FormBuilder.create();
  b.textField('visible.name', [36, 700, 300, 726]);
  await b.drawText('Full name', 36, 740);
  const rect = await setup(b);
  await b.drawText(CANARY, rect[0] + 2, rect[1] + 4);
  const fields = await evidence(b);
  return { fields, json: JSON.stringify(fields) };
}

describe('item 1: privacy guards come from every widget annotation on the page', () => {
  it('a canary inside the 21st widget of one field never appears', async () => {
    let lastRect: Rect = [0, 0, 0, 0];
    const { fields, json } = await guardCase((b) => {
      const parent = b.node({ FT: PDFName.of('Tx'), T: PDFString.of('copies') }, true);
      const kids = Array.from({ length: 21 }, (_, i) => {
        lastRect = [320, 100 + i * 20, 560, 116 + i * 20];
        return b.widget(lastRect, { parent: parent.ref }).ref;
      });
      b.setKids(parent.dict, kids);
      return lastRect;
    });
    // The cap really dropped the 21st widget from the evidence.
    expect(fields.find((f) => f.fieldId === 'copies')!.widgets).toHaveLength(20);
    expect(json).toContain('Full name');
    expect(json).not.toContain(CANARY);
  });

  it('a canary inside a pushbutton never appears', async () => {
    const rect: Rect = [320, 600, 500, 626];
    const { fields, json } = await guardCase((b) => {
      b.textField('print', rect, { FT: PDFName.of('Btn'), Ff: 65536 });
      return rect;
    });
    expect(fields.map((f) => f.fieldId)).toEqual(['visible.name']);
    expect(json).not.toContain(CANARY);
  });

  it('a canary inside a nameless field never appears', async () => {
    const rect: Rect = [320, 600, 500, 626];
    const { json } = await guardCase((b) => {
      const f = b.node({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'), Rect: b.ctx.obj(rect) }, true);
      b.annotate(f.ref);
      return rect;
    });
    expect(json).not.toContain(CANARY);
  });

  it('a canary inside an orphan widget (not in the field tree) never appears', async () => {
    const rect: Rect = [320, 600, 500, 626];
    const { json } = await guardCase((b) => {
      b.widget(rect); // listed in /Annots only
      return rect;
    });
    expect(json).not.toContain(CANARY);
  });

  it('a page with an unresolvable annotation reference gets no snippets', async () => {
    const b = await FormBuilder.create();
    b.textField('visible.name', [36, 700, 300, 726]);
    await b.drawText('Full name', 36, 740);
    b.annotate(b.ctx.nextRef()); // reference to an object that does not exist
    const doc = b.doc;
    expect(pageGuardRects(doc, 0)).toBeUndefined();
    const [f] = await evidence(b);
    expect(f!.widgets[0]!.pageSnippet).toBe('');
  });

  it('a page with a malformed widget rectangle gets no snippets', async () => {
    const b = await FormBuilder.create();
    b.textField('visible.name', [36, 700, 300, 726]);
    await b.drawText('Full name', 36, 740);
    b.widget([320, 600, 500, 626]).dict.set(PDFName.of('Rect'), b.ctx.obj([PDFString.of('x'), 1, 2, 3]));
    const [f] = await evidence(b);
    expect(f!.widgets[0]!.pageSnippet).toBe('');
  });

  it('non-widget annotations do not count as guards', async () => {
    const b = await FormBuilder.create();
    b.textField('visible.name', [36, 700, 300, 726]);
    const link = b.node({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: b.ctx.obj([0, 0, 595, 842]) });
    b.annotate(link.ref);
    expect(pageGuardRects(b.doc, 0)).toHaveLength(1);
  });
});

describe('item 2: duplicate field nodes cannot hide a signed document', () => {
  async function duplicateSigs() {
    const b = await FormBuilder.create();
    b.textField('probe.name', [36, 700, 300, 726]);
    b.textField('sig', [36, 600, 300, 650], { FT: PDFName.of('Sig') });
    const sigDict = b.ctx.register(b.ctx.obj({ Type: PDFName.of('Sig') }));
    b.textField('sig', [36, 500, 300, 550], { FT: PDFName.of('Sig'), V: sigDict });
    return b.save();
  }

  it('rejects as SIGNED when the second same-named /Sig node has /V << /Type /Sig >>', async () => {
    expect(await checkPdf(await duplicateSigs())).toMatchObject({ rejected: true, code: 'SIGNED' });
  });

  it('rejects as SIGNED even when the merged field turns out unsupported (conflicting /FT)', async () => {
    const b = await FormBuilder.create();
    b.textField('probe.name', [36, 700, 300, 726]);
    b.textField('mixed', [36, 600, 300, 650], { FT: PDFName.of('Tx') });
    b.textField('mixed', [36, 500, 300, 550], { FT: PDFName.of('Sig'), V: b.ctx.register(b.ctx.obj({ Type: PDFName.of('Sig') })) });
    expect(await checkPdf(await b.save())).toMatchObject({ rejected: true, code: 'SIGNED' });
  });

  it('marks duplicates with conflicting /FT as unsupported (fill yourself)', async () => {
    const b = await FormBuilder.create();
    b.textField('mixed', [36, 600, 300, 650], { FT: PDFName.of('Tx') });
    b.textField('mixed', [36, 500, 300, 550], { FT: PDFName.of('Btn') });
    const [f] = await evidence(b);
    expect(f).toMatchObject({ fieldId: 'mixed', unsupported: true });
    expect(f!.widgets).toHaveLength(2);
    expect(classifyField(f!, { fieldId: 'mixed', humanLabel: 'M', question: 'M?', answerType: 'text', confidence: 1 })).toBe(
      'fill-yourself',
    );
  });
});

describe('item 3: field names longer than 256 characters', () => {
  it('gets a schema-valid local id, is fill-yourself and is never sent to analysis', async () => {
    const b = await FormBuilder.create();
    const longName = 'x'.repeat(257);
    b.textField(longName, [36, 700, 300, 726]);
    b.textField('normal', [36, 600, 300, 626]);
    const fields = await evidence(b);
    expect(fields).toHaveLength(2);
    const long = fields.find((f) => f.idTooLong)!;
    expect(long.fieldId).toBe('long-field-1');
    expect(long.fieldId.length).toBeLessThanOrEqual(256);
    expect(FieldEvidenceSchema.safeParse(long).success).toBe(true);
    expect(needsAnalysis(long)).toBe(false);
    expect(classifyField(long, null)).toBe('fill-yourself');
    expect(fields.filter(needsAnalysis).map((f) => f.fieldId)).toEqual(['normal']);
  });

  it('checks the final dotted name, not only one part of it', async () => {
    const b = await FormBuilder.create();
    const parent = b.node({ T: PDFString.of('p'.repeat(200)) }, true);
    const kid = b.node({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      FT: PDFName.of('Tx'),
      T: PDFString.of('c'.repeat(60)),
      Parent: parent.ref,
      Rect: b.ctx.obj([36, 700, 300, 726]),
    });
    b.annotate(kid.ref);
    b.setKids(parent.dict, [kid.ref]);
    const [f] = await evidence(b);
    expect(f!.idTooLong).toBe(true);
  });

  it('local ids never collide with a real field name', async () => {
    const b = await FormBuilder.create();
    b.textField('long-field-1', [36, 700, 300, 726]);
    b.textField('y'.repeat(300), [36, 600, 300, 626]);
    const ids = (await evidence(b)).map((f) => f.fieldId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('long-field-2');
  });
});

describe('item 5: stronger structural tests', () => {
  it('named kids whose /FT is only on the parent extract as contact.city and contact.state text fields', async () => {
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
    const fields = await evidence(b);
    expect(fields.map((f) => [f.fieldId, f.fieldType])).toEqual([
      ['contact.city', 'text'],
      ['contact.state', 'text'],
    ]);
  });

  it('a named terminal child without its own /V inherits the parent /V and rejects as SIGNED', async () => {
    const b = await FormBuilder.create();
    b.textField('probe.name', [36, 700, 300, 726]);
    const sigDict = b.ctx.register(b.ctx.obj({ Type: PDFName.of('Sig') }));
    const parent = b.node({ FT: PDFName.of('Sig'), T: PDFString.of('consent'), V: sigDict }, true);
    const child = b.node({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('signature'),
      Parent: parent.ref,
      Rect: b.ctx.obj([36, 600, 300, 650]),
    });
    b.annotate(child.ref);
    b.setKids(parent.dict, [child.ref]);
    expect(child.dict.get(PDFName.of('V'))).toBeUndefined();
    expect(await checkPdf(await b.save())).toMatchObject({ rejected: true, code: 'SIGNED' });
  });

  it('every evidence record passes the schema: long names, duplicates, extreme geometry, many widgets', async () => {
    const b = await FormBuilder.create();
    b.textField('a'.repeat(256), [36, 700, 300, 726]);
    b.textField('a'.repeat(400), [36, 650, 300, 676]);
    b.textField('dup', [36, 600, 300, 626]);
    b.textField('dup', [36, 560, 300, 586]);
    b.textField('huge', [-1e9, -1e9, 1e9, 1e9]);
    b.textField('tiny', [10, 10, 10, 10]);
    const many = b.node({ FT: PDFName.of('Btn'), Ff: 32768, T: PDFString.of('many') }, true);
    b.setKids(
      many.dict,
      Array.from({ length: 40 }, (_, i) => b.widget([400, 20 + i * 15, 412, 32 + i * 15], { parent: many.ref }).ref),
    );
    const fields = await evidence(b);
    expect(fields.map((f) => f.fieldId)).toEqual(['a'.repeat(256), 'long-field-1', 'dup', 'huge', 'tiny', 'many']);
    expect(fields.find((f) => f.fieldId === 'dup')!.widgets).toHaveLength(2);
    expect(fields.find((f) => f.fieldId === 'many')!.widgets).toHaveLength(20);
    for (const f of fields) {
      const r = FieldEvidenceSchema.safeParse(f);
      expect(r.success, `${f.fieldId.slice(0, 20)}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });
});

describe('empty choice exports (placeholder options)', () => {
  it('drops "" options from the answers and remembers the placeholder', async () => {
    const b = await FormBuilder.create();
    b.textField('pick', [36, 700, 300, 726], {
      FT: PDFName.of('Ch'),
      Ff: 131072,
      Opt: b.ctx.obj([
        b.ctx.obj([PDFString.of(''), PDFString.of('Please choose')]),
        b.ctx.obj([PDFString.of('A'), PDFString.of('Alpha')]),
        PDFString.of('  '),
      ]),
    });
    const [f] = await evidence(b);
    expect(f!.options).toEqual([{ exportValue: 'A', displayLabel: 'Alpha' }]);
    expect(f!.hasPlaceholderOption).toBe(true);
  });

  it('a choice field without placeholders has no marker', async () => {
    const b = await FormBuilder.create();
    b.textField('pick', [36, 700, 300, 726], { FT: PDFName.of('Ch'), Ff: 131072, Opt: b.ctx.obj([PDFString.of('A')]) });
    const [f] = await evidence(b);
    expect(f!.hasPlaceholderOption).toBeUndefined();
  });
});
