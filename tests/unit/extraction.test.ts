/**
 * tests/unit/extraction.test.ts
 *
 * Task 9.4 and review items 1, 2, 3, 5, 6 and 7: logical fields match pdf-lib's
 * own field list, widgets are grouped per field, field types match the fixture
 * spec, prefilled values never leak into evidence, and malformed or unusual
 * structures degrade instead of throwing.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 11.1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { extractFields } from '../../src/lib/pdf-extract/index.js';
import { FieldEvidenceSchema } from '../../src/shared/schemas.js';
import type { FieldEvidence } from '../../src/shared/types.js';
import { FormBuilder } from '../helpers/pdf-builder.js';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join('fixtures', name)));

async function fieldsOf(bytes: Uint8Array, opts = {}): Promise<FieldEvidence[]> {
  const r = await extractFields(bytes, opts);
  if (!r.ok) throw new Error(`unexpected rejection ${r.code}`);
  return r.fields;
}

const byId = (fields: FieldEvidence[]) => new Map(fields.map((f) => [f.fieldId, f]));

const ACCEPTED_FIXTURES = [
  'clinic-registration.pdf',
  'school-enrolment.pdf',
  'us-community-clinic.pdf',
  'prefilled-field.pdf',
  'sig-empty.pdf',
];

describe('field identity matches pdf-lib (review item 1)', () => {
  it.each(ACCEPTED_FIXTURES)('%s: one record per pdf-lib field name, in the same set', async (name) => {
    const bytes = fixture(name);
    const fields = await fieldsOf(bytes);
    const doc = await PDFDocument.load(bytes);
    const expected = doc.getForm().getFields().map((f) => f.getName()).sort();
    const ids = fields.map((f) => f.fieldId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(expected);
  });

  it.each([
    ['clinic-registration.pdf', 22],
    ['school-enrolment.pdf', 10],
    ['us-community-clinic.pdf', 14],
    ['prefilled-field.pdf', 5],
    ['sig-empty.pdf', 2],
  ])('%s has %i logical fields', async (name, count) => {
    expect(await fieldsOf(fixture(name))).toHaveLength(count);
  });

  it('every evidence record passes the shared schema', async () => {
    for (const name of ACCEPTED_FIXTURES) {
      for (const f of await fieldsOf(fixture(name))) {
        expect(FieldEvidenceSchema.safeParse(f).success, `${name} ${f.fieldId}`).toBe(true);
      }
    }
  });

  it('a text field with two widget kids is one record with two widgets', async () => {
    const b = await FormBuilder.create();
    const parent = b.node({ FT: PDFName.of('Tx'), T: PDFString.of('copy.name'), MaxLen: 20 }, true);
    const w1 = b.widget([36, 700, 300, 726], { parent: parent.ref });
    const w2 = b.widget([36, 600, 300, 626], { parent: parent.ref });
    b.setKids(parent.dict, [w1.ref, w2.ref]);
    const fields = await fieldsOf(await b.save());
    expect(fields).toHaveLength(1);
    expect(fields[0]!.widgets).toHaveLength(2);
    expect(fields[0]!.maxLength).toBe(20);
  });

  it('a local /MaxLen overrides the inherited one', async () => {
    const b = await FormBuilder.create();
    const parent = b.node({ FT: PDFName.of('Tx'), T: PDFString.of('p'), MaxLen: 40 }, true);
    const kid = b.node({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('code'),
      Parent: parent.ref,
      MaxLen: 4,
      Rect: b.ctx.obj([36, 700, 300, 726]),
    });
    b.annotate(kid.ref);
    b.setKids(parent.dict, [kid.ref]);
    const [f] = await fieldsOf(await b.save());
    expect(f).toMatchObject({ fieldId: 'p.code', fieldType: 'text', maxLength: 4 });
  });
});

describe('clinic-registration.pdf evidence', () => {
  it('assigns the field types from the fixture spec', async () => {
    const f = byId(await fieldsOf(fixture('clinic-registration.pdf')));
    expect(f.get('patient.gender')?.fieldType).toBe('radio');
    expect(f.get('contact.state')?.fieldType).toBe('dropdown');
    expect(f.get('visit.firstVisit')?.fieldType).toBe('checkbox');
    expect(f.get('consent.signature')?.fieldType).toBe('signature');
    expect(f.get('Text1')?.fieldType).toBe('text');
    expect(f.get('contact.address')?.multiline).toBe(true);
  });

  it('groups the three gender widgets into one field with exports F, M, X', async () => {
    const gender = byId(await fieldsOf(fixture('clinic-registration.pdf'))).get('patient.gender')!;
    expect(gender.widgets).toHaveLength(3);
    expect(gender.options?.map((o) => o.exportValue)).toEqual(['F', 'M', 'X']);
  });

  it.each([
    ['clinic-registration.pdf', 'patient.gender', [['F', 'Perempuan'], ['M', 'Lelaki'], ['X', 'Tidak dinyatakan']]],
    ['us-community-clinic.pdf', 'visit.contactMethod', [['P', 'Phone'], ['E', 'Email'], ['N', 'Neither']]],
    ['school-enrolment.pdf', 'admission.session', [['AM', 'Morning / Pagi'], ['PM', 'Afternoon / Petang']]],
  ])('%s: each %s button is shown with the label printed beside it, and keeps its export value', async (file, id, pairs) => {
    const field = byId(await fieldsOf(fixture(file))).get(id)!;
    expect(field.options).toEqual(pairs.map(([exportValue, displayLabel]) => ({ exportValue, displayLabel })));
  });

  it('keeps dropdown export values distinct from display labels', async () => {
    const state = byId(await fieldsOf(fixture('clinic-registration.pdf'))).get('contact.state')!;
    expect(state.options).toContainEqual({ exportValue: 'SGR', displayLabel: 'Selangor' });
  });

  it('reads flags, tooltip and MaxLen', async () => {
    const f = byId(await fieldsOf(fixture('clinic-registration.pdf')));
    expect(f.get('patient.fullName')).toMatchObject({ required: true, readOnly: false, maxLength: 70 });
    expect(f.get('clinic.branchCode')).toMatchObject({ readOnly: true, maxLength: 8 });
    expect(f.get('Text1')?.tooltip).toBeUndefined();
    expect(f.get('patient.birthDate')?.tooltip).toBe('Tarikh lahir dalam format DD/MM/YYYY');
  });

  // Review 2, item 4: each snippet starts with the field's own printed label.
  it('starts every snippet with the field’s own printed label (fixture spec labels)', async () => {
    const OWN_LABEL: Record<string, string[]> = {
      'patient.fullName': ['Nama penuh'],
      Text1: ['No. Kad Pengenalan'],
      'patient.birthDate': ['Tarikh Lahir (DD/MM/YYYY)'],
      'patient.gender': ['Jantina', 'Lelaki', 'Tidak dinyatakan'],
      'clinic.branchCode': ['Kod cawangan'],
      Text7: ['Rujukan'],
      'contact.mobile': ['Telefon bimbit'],
      'contact.homePhone': ['Telefon rumah'],
      Text3: ['E-mel'],
      'contact.address': ['Alamat surat-menyurat'],
      'contact.postcode': ['Poskod'],
      'contact.city': ['Bandar'],
      'contact.state': ['Negeri / Wilayah'],
      'visit.date': ['Tarikh lawatan'],
      'visit.firstVisit': ['Lawatan pertama'],
      'medical.allergyFlag': ['Ada alahan'],
      'medical.description': ['Sebab lawatan / gejala'],
      'emergency.name': ['Nama untuk dihubungi semasa kecemasan'],
      'emergency.phone': ['Telefon kecemasan'],
      'consent.contact': ['Saya bersetuju untuk dihubungi'],
      'visit.shortCode': ['Kod ringkas (maksimum 4 aksara)'],
      'consent.signature': ['Tandatangan pesakit'],
    };
    const f = byId(await fieldsOf(fixture('clinic-registration.pdf')));
    expect([...f.keys()].sort()).toEqual(Object.keys(OWN_LABEL).sort());
    for (const [id, labels] of Object.entries(OWN_LABEL)) {
      const snippets = f.get(id)!.widgets.map((w) => w.pageSnippet);
      expect(snippets.length, id).toBe(labels.length);
      snippets.forEach((s, i) => expect(s.startsWith(labels[i]!), `${id} widget ${i}: "${s}"`).toBe(true));
    }
  });

  it('does not run on into the labels of other rows or the form title', async () => {
    const name = byId(await fieldsOf(fixture('clinic-registration.pdf'))).get('patient.fullName')!;
    const s = name.widgets[0]!.pageSnippet;
    for (const other of ['No. Kad Pengenalan', 'Tarikh Lahir', 'Borang Pendaftaran Pesakit', 'Perempuan', 'Lelaki']) {
      expect(s).not.toContain(other);
    }
  });

  it('reports page number and top-origin bbox from the fixture spec', async () => {
    const name = byId(await fieldsOf(fixture('clinic-registration.pdf'))).get('patient.fullName')!;
    const w = name.widgets[0]!;
    expect(w.pageNumber).toBe(1);
    expect(w.bbox.left).toBeCloseTo(36);
    expect(w.bbox.top).toBeCloseTo(132);
    expect(w.bbox.right).toBeCloseTo(330);
    expect(w.bbox.bottom).toBeCloseTo(154);
  });
});

describe('school-enrolment.pdf evidence', () => {
  it('treats the single-select list box as a dropdown (decision 8)', async () => {
    const club = byId(await fieldsOf(fixture('school-enrolment.pdf'))).get('Text7')!;
    expect(club.fieldType).toBe('dropdown');
    expect(club.multiSelect).toBeUndefined();
    expect(club.options?.map((o) => o.exportValue)).toEqual(['ART', 'SCI', 'MUS']);
  });

  it('groups the session radio into one field with exports AM and PM', async () => {
    const s = byId(await fieldsOf(fixture('school-enrolment.pdf'))).get('admission.session')!;
    expect(s.widgets).toHaveLength(2);
    expect(s.options?.map((o) => o.exportValue)).toEqual(['AM', 'PM']);
    expect(s.required).toBe(true);
  });
});

describe('privacy: prefilled values never leave as evidence (requirement 11.1)', () => {
  const CANARIES = ['VALUE_ONLY_CANARY_7Q2', 'RO_ONLY_CANARY_9R4', 'NO_AP_CANARY_3M8'];

  // Review 2, item 5: first prove the canaries are really in the fixture, then prove they never leave.
  it('the canaries really are in the fixture values, defaults and appearances', async () => {
    const form = (await PDFDocument.load(fixture('prefilled-field.pdf'))).getForm();
    expect(form.getTextField('person.name').getText()).toBe('VALUE_ONLY_CANARY_7Q2');
    expect(form.getTextField('office.code').getText()).toBe('RO_ONLY_CANARY_9R4');
    expect(form.getTextField('Text7').getText()).toBe('NO_AP_CANARY_3M8');
    const dv = (name: string) => form.getField(name).acroField.dict.lookup(PDFName.of('DV'));
    expect((dv('person.name') as PDFString).decodeText()).toBe('VALUE_ONLY_CANARY_7Q2');
    expect((dv('office.code') as PDFString).decodeText()).toBe('RO_ONLY_CANARY_9R4');
    expect(dv('Text7')).toBeUndefined();
    expect(form.getDropdown('office.route').getSelected()).toEqual(['B']);
  });

  it('no canary appears anywhere in the serialized evidence, with real snippets present', async () => {
    const fields = await fieldsOf(fixture('prefilled-field.pdf'));
    expect(fields.every((f) => f.widgets.every((w) => w.pageSnippet.length > 0))).toBe(true);
    const json = JSON.stringify(fields);
    for (const c of CANARIES) expect(json).not.toContain(c);
  });

  it('two PDFs differing only in the selected option give identical evidence', async () => {
    const original = fixture('prefilled-field.pdf');
    const doc = await PDFDocument.load(original, { updateMetadata: false });
    const route = doc.getForm().getDropdown('office.route').acroField.dict;
    route.set(PDFName.of('V'), PDFString.of('A'));
    route.set(PDFName.of('I'), doc.context.obj([0]));
    const changed = await doc.save({ updateFieldAppearances: false });
    // The selection really differs between the two files.
    expect((await PDFDocument.load(changed)).getForm().getDropdown('office.route').getSelected()).toEqual(['A']);
    expect(await fieldsOf(changed)).toEqual(await fieldsOf(original));
  });

  it('drops page text drawn inside a widget, even when it is static page content', async () => {
    const b = await FormBuilder.create();
    b.textField('person.name', [36, 700, 300, 726]);
    await b.drawText('Full name', 36, 732);
    await b.drawText('INSIDE_FIELD_SENTINEL', 40, 708);
    const [f] = await fieldsOf(await b.save());
    expect(f!.widgets[0]!.pageSnippet).toContain('Full name');
    expect(f!.widgets[0]!.pageSnippet).not.toContain('INSIDE_FIELD_SENTINEL');
  });
});

describe('unsupported controls (review item 5)', () => {
  it('leaves pushbuttons out of the evidence', async () => {
    const b = await FormBuilder.create();
    b.textField('name', [36, 700, 300, 726]);
    b.textField('print', [36, 600, 120, 626], { FT: PDFName.of('Btn'), Ff: 65536 });
    const fields = await fieldsOf(await b.save());
    expect(fields.map((f) => f.fieldId)).toEqual(['name']);
  });

  it('marks multi-select list boxes with multiSelect: true', async () => {
    const b = await FormBuilder.create();
    b.textField('clubs', [36, 600, 300, 700], {
      FT: PDFName.of('Ch'),
      Ff: 2097152,
      Opt: b.ctx.obj([PDFString.of('ART'), PDFString.of('SCI')]),
    });
    const [f] = await fieldsOf(await b.save());
    expect(f).toMatchObject({ fieldType: 'dropdown', multiSelect: true });
  });
});

describe('radio export values (review item 6)', () => {
  async function radio(withOpt: boolean) {
    const b = await FormBuilder.create();
    const group = b.node(
      {
        FT: PDFName.of('Btn'),
        Ff: 32768,
        T: PDFString.of('choice'),
        ...(withOpt ? { Opt: b.ctx.obj([PDFString.of('Option one'), PDFString.of('Option two')]) } : {}),
      },
      true,
    );
    const kids = [0, 1].map((i) => {
      const on = b.ctx.register(b.ctx.stream('0 g'));
      const off = b.ctx.register(b.ctx.stream('0 G'));
      const n = b.ctx.obj({});
      n.set(PDFName.of(i === 0 ? 'Yes please' : '1'), on);
      n.set(PDFName.of('Off'), off);
      return b.widget([36 + i * 100, 700, 50 + i * 100, 714], {
        parent: group.ref,
        extra: { AP: b.ctx.obj({ N: n }), AS: PDFName.of('Off') },
      }).ref;
    });
    b.setKids(group.dict, kids);
    return (await fieldsOf(await b.save()))[0]!;
  }

  it('uses /Opt strings, mapped to widgets in order, when present', async () => {
    expect((await radio(true)).options?.map((o) => o.exportValue)).toEqual(['Option one', 'Option two']);
  });

  it('decodes #20 escapes in appearance state names when there is no /Opt', async () => {
    expect((await radio(false)).options?.map((o) => o.exportValue)).toEqual(['Yes please', '1']);
  });
});

describe('widget pages (review item 7)', () => {
  it('resolves a widget page through /P when the widget is not in /Annots', async () => {
    const b = await FormBuilder.create(2);
    const parent = b.node({ FT: PDFName.of('Tx'), T: PDFString.of('p2') }, true);
    const w = b.widget([36, 700, 300, 726], { parent: parent.ref, onAnnots: false, extra: { P: b.page(1).ref } });
    b.setKids(parent.dict, [w.ref]);
    const [f] = await fieldsOf(await b.save());
    expect(f!.widgets[0]!.pageNumber).toBe(2);
  });

  it('marks a field with no resolvable page instead of placing it on page 1', async () => {
    const b = await FormBuilder.create(2);
    b.textField('placed', [36, 700, 300, 726]);
    const parent = b.node({ FT: PDFName.of('Tx'), T: PDFString.of('lost') }, true);
    const w = b.widget([36, 600, 300, 626], { parent: parent.ref, onAnnots: false });
    b.setKids(parent.dict, [w.ref]);
    const lost = byId(await fieldsOf(await b.save())).get('lost')!;
    expect(lost.unresolvedPage).toBe(true);
    expect(lost.widgets).toEqual([]);
    expect(FieldEvidenceSchema.safeParse(lost).success).toBe(true);
  });

  it('marks a field whose only /Rect is invalid as unresolved', async () => {
    const b = await FormBuilder.create();
    b.textField('bad', [36, 700, 300, 726]).dict.set(PDFName.of('Rect'), b.ctx.obj([PDFString.of('x'), 1, 2, 3]));
    const [f] = await fieldsOf(await b.save());
    expect(f).toMatchObject({ fieldId: 'bad', unresolvedPage: true });
  });
});

describe('robustness (review item 2)', () => {
  it('keeps fields with empty snippets when the text loader fails', async () => {
    const r = await extractFields(fixture('sig-empty.pdf'), {
      loadPageText: async () => {
        throw new Error('pdf.js could not parse this file');
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields).toHaveLength(2);
      expect(r.fields.every((f) => f.widgets.every((w) => w.pageSnippet === ''))).toBe(true);
    }
  });

  it('keeps fields when the loader returns no text for a page', async () => {
    const b = await FormBuilder.create();
    b.textField('name', [36, 700, 300, 726]);
    const r = await extractFields(await b.save(), { loadPageText: async () => new Map() });
    expect(r.ok && r.fields[0]!.widgets[0]!.pageSnippet).toBe('');
  });

  it('stops at a /Kids cycle: the cyclic branch yields no field, the rest still extracts', async () => {
    const b = await FormBuilder.create();
    b.textField('ok', [36, 700, 300, 726]);
    const a = b.node({ T: PDFString.of('a'), FT: PDFName.of('Tx') }, true);
    const c = b.node({ T: PDFString.of('c'), Parent: a.ref });
    b.setKids(a.dict, [c.ref]);
    b.setKids(c.dict, [a.ref]);
    const fields = await fieldsOf(await b.save());
    expect(fields.map((f) => f.fieldId)).toEqual(['ok']);
  });
});

describe('snippet geometry safety (review item 3)', () => {
  async function snippetWith(setup: (b: FormBuilder) => void) {
    const b = await FormBuilder.create();
    b.textField('name', [36, 700, 300, 726]);
    await b.drawText('Full name', 36, 740);
    setup(b);
    const [f] = await fieldsOf(await b.save());
    return f!.widgets[0]!.pageSnippet;
  }

  it('produces a snippet on an ordinary page', async () => {
    expect(await snippetWith(() => {})).toContain('Full name');
  });

  it('gives no snippets on a rotated page', async () => {
    expect(await snippetWith((b) => b.page().setRotation(degrees(90)))).toBe('');
  });

  it('gives no snippets when the crop box origin is not (0,0)', async () => {
    expect(await snippetWith((b) => b.page().setCropBox(10, 10, 500, 800))).toBe('');
  });
});
