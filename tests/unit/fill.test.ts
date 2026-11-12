/**
 * tests/unit/fill.test.ts
 *
 * Tasks 19 and 20: fillPdf writes the Nov 17 acceptance answers exactly,
 * leaves untouched fields alone, and blocks every unsafe write instead of
 * producing a damaged PDF.
 * Validates: Requirements 7.8, 8.5, 8.7, 10.1, 10.2, 10.3
 */

import { describe, it, expect } from 'vitest';
import { PDFCheckBox, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField } from 'pdf-lib';
import { CharacterNotRepresentableError, defaultFontSize, fillPdf, FillError, type FieldAnswer } from '../../src/lib/pdf-fill/index.js';
import { TextOverflowError, MIN_FONT_SIZE } from '../../src/lib/pdf-fill/overflow.js';
import { chooseFont, clearLoadedFonts, firstMissingCodePoint, loadFont } from '../../src/lib/pdf-fill/font.js';
import { appearanceState, appearanceStreams, fixtureBytes, FULL_FONT, glyphHex, LATIN_MAP, load, snapshot, SUBSET_FONT } from '../helpers/fill-helpers.js';

const text = (value: string): FieldAnswer => ({ kind: 'text', value });
const choice = (exportValue: string): FieldAnswer => ({ kind: 'choice', exportValue });
const box = (state: 'checked' | 'unchecked' | 'skipped'): FieldAnswer => ({ kind: 'checkbox', state });
const fill = (file: string, entries: Record<string, FieldAnswer>, map = LATIN_MAP) =>
  fillPdf(fixtureBytes(file), new Map(Object.entries(entries)), map);

/** Fixture spec section 1: the synthetic Chinese-interface answers, as final PDF values. */
const NOV17: Record<string, FieldAnswer> = {
  'patient.fullName': text('LIN MEI TEST'),
  Text1: text('900101101234'),
  'patient.birthDate': text('01/01/1990'),
  'patient.gender': choice('F'),
  Text7: text('REF-A'),
  'contact.mobile': text('011-2345 6789'),
  'contact.homePhone': text('03-2345 6789'),
  Text3: text('lin.mei@example.invalid'),
  'contact.address': text('Unit Ujian 8, Jalan Rekaan Ungu\nKawasan Rekaan'),
  'contact.postcode': text('43000'),
  'contact.city': text('Bandar Rekaan'),
  'contact.state': choice('SGR'),
  'visit.date': text('17/11/2026'),
  'visit.firstVisit': box('checked'),
  'medical.allergyFlag': box('unchecked'),
  'medical.description': text('Saya batuk selama dua hari.'),
  'emergency.name': text('LIN HAO TEST'),
  'emergency.phone': text('012-345 6789'),
  'consent.contact': box('skipped'),
  'visit.shortCode': text('A123'),
};

describe('the Nov 17 acceptance answers', () => {
  it('writes every value exactly and keeps what must stay', async () => {
    const before = await load(fixtureBytes('clinic-registration.pdf'));
    const out = await load(await fill('clinic-registration.pdf', NOV17));
    const form = out.getForm();

    const textValue = (n: string) => form.getTextField(n).getText();
    expect(textValue('patient.fullName')).toBe('LIN MEI TEST');
    expect(textValue('Text1')).toBe('900101101234');
    expect(textValue('patient.birthDate')).toBe('01/01/1990');
    expect(textValue('contact.mobile')).toBe('011-2345 6789');
    expect(textValue('contact.homePhone')).toBe('03-2345 6789');
    expect(textValue('contact.address')).toBe('Unit Ujian 8, Jalan Rekaan Ungu\nKawasan Rekaan');
    expect(textValue('emergency.phone')).toBe('012-345 6789');
    expect(textValue('medical.description')).toBe('Saya batuk selama dua hari.');
    expect(textValue('visit.shortCode')).toBe('A123');

    expect(form.getRadioGroup('patient.gender').getSelected()).toBe('F');
    expect(form.getDropdown('contact.state').getSelected()).toEqual(['SGR']);
    expect(form.getCheckBox('visit.firstVisit').isChecked()).toBe(true);
    expect(form.getCheckBox('medical.allergyFlag').isChecked()).toBe(false);

    // Skipped checkbox, read-only code, empty signature: untouched.
    for (const name of ['consent.contact', 'clinic.branchCode', 'consent.signature']) {
      expect(snapshot(out, name), name).toBe(snapshot(before, name));
    }
    expect(form.getCheckBox('consent.contact').isChecked()).toBe(true);
    expect(form.getTextField('clinic.branchCode').getText()).toBe('AU-TEST');
    expect(form.getSignature('consent.signature').acroField.dict.has(PDFName.of('V'))).toBe(false);
  });

  it('stores the dropdown export value but draws its display label', async () => {
    const out = await load(await fill('clinic-registration.pdf', { 'contact.state': choice('SGR') }));
    const field = out.getForm().getDropdown('contact.state');
    expect(field.getSelected()).toEqual(['SGR']);
    const [stream] = appearanceStreams(field);
    expect(stream).toContain(await glyphHex('Selangor'));
    expect(stream).not.toContain(await glyphHex('SGR'));
  });

  it('an explicit uncheck writes the off state, a skip keeps the original checked state', async () => {
    const unchecked = await load(await fill('clinic-registration.pdf', { 'consent.contact': box('unchecked') }));
    const skipped = await load(await fill('clinic-registration.pdf', { 'consent.contact': box('skipped') }));
    expect(unchecked.getForm().getCheckBox('consent.contact').isChecked()).toBe(false);
    expect(skipped.getForm().getCheckBox('consent.contact').isChecked()).toBe(true);
    expect(appearanceState(unchecked.getForm().getCheckBox('consent.contact'))).toEqual(['/Off']);
    expect(appearanceState(skipped.getForm().getCheckBox('consent.contact'))).toEqual(['/Yes']);
  });

  it('draws the written text with the embedded font', async () => {
    const out = await load(await fill('clinic-registration.pdf', { Text3: text('lin.mei@example.invalid') }));
    expect(appearanceStreams(out.getForm().getTextField('Text3'))[0]).toContain(await glyphHex('lin.mei@example.invalid'));
  });
});

describe('school form choices (list box and radio exports)', () => {
  it('writes list box and radio export values and highlights the chosen option', async () => {
    const out = await load(await fill('school-enrolment.pdf', { Text7: choice('SCI'), 'admission.session': choice('PM'), 'admission.year': choice('Y2') }));
    const form = out.getForm();
    const club = form.getField('Text7');
    expect(club).toBeInstanceOf(PDFOptionList);
    expect((club as PDFOptionList).getSelected()).toEqual(['SCI']);
    expect(form.getRadioGroup('admission.session').getSelected()).toBe('PM');
    expect(form.getDropdown('admission.year').getSelected()).toEqual(['Y2']);
  });
});

describe('unsafe writes are blocked', () => {
  const rejects = (file: string, entries: Record<string, FieldAnswer>, map = LATIN_MAP) => fill(file, entries, map).then(() => null, (e: unknown) => e);

  it('rejects an option that is not in the PDF, for dropdown and radio (requirement 7.8)', async () => {
    expect(await rejects('clinic-registration.pdf', { 'contact.state': choice('ZZZ') })).toMatchObject({ code: 'INVALID_CHOICE' });
    expect(await rejects('clinic-registration.pdf', { 'contact.state': choice('Selangor') })).toMatchObject({ code: 'INVALID_CHOICE' });
    expect(await rejects('clinic-registration.pdf', { 'patient.gender': choice('UNKNOWN') })).toMatchObject({ code: 'INVALID_CHOICE' });
  });

  it('rejects an answer longer than MaxLen instead of truncating', async () => {
    expect(await rejects('clinic-registration.pdf', { 'visit.shortCode': text('ABCDE') })).toMatchObject({ code: 'MAX_LENGTH' });
    const ok = await load(await fill('clinic-registration.pdf', { 'visit.shortCode': text('ABCD') }));
    expect(ok.getForm().getTextField('visit.shortCode').getText()).toBe('ABCD');
  });

  it('rejects a character the font cannot draw, naming the code point (requirement 8.7)', async () => {
    const err = await rejects('clinic-registration.pdf', { 'patient.fullName': text('LIN \u4e2d TEST') });
    expect(err).toBeInstanceOf(CharacterNotRepresentableError);
    expect(err).toMatchObject({ code: 'CHARACTER_NOT_REPRESENTABLE', codePoint: 0x4e2d, fieldId: 'patient.fullName' });
  });

  it('rejects text that cannot fit even at the minimum size', async () => {
    // 70 capital W (the MaxLen of the field) is far wider than the 249pt field.
    const overflow = await rejects('clinic-registration.pdf', { 'emergency.name': text('W'.repeat(70)) });
    expect(overflow).toBeInstanceOf(TextOverflowError);
    expect(overflow).toMatchObject({ fieldId: 'emergency.name', multiline: false });
  });

  it('rejects a multiline answer taller than its field at the minimum size', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    expect(await rejects('clinic-registration.pdf', { 'medical.description': text(lines.slice(0, 180)) })).toBeInstanceOf(TextOverflowError);
  });

  it('shrinks the font to fit a long answer, never below the minimum', async () => {
    const out = await load(await fill('clinic-registration.pdf', { 'emergency.name': text('LIN HAO TEST WITH A LONG NAME') }));
    const da = out.getForm().getTextField('emergency.name').acroField.getDefaultAppearance() ?? '';
    const size = defaultFontSize(da);
    expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
    expect(size).toBeLessThanOrEqual(10);
  });

  it('never writes signature or read-only fields', async () => {
    expect(await rejects('clinic-registration.pdf', { 'consent.signature': text('X') })).toMatchObject({ code: 'WRONG_ANSWER_KIND' });
    expect(await rejects('clinic-registration.pdf', { 'clinic.branchCode': text('X') })).toMatchObject({ code: 'FIELD_NOT_WRITABLE' });
    const out = await load(await fillPdf(fixtureBytes('clinic-registration.pdf'), new Map(), LATIN_MAP));
    expect(out.getForm().getField('consent.signature')).toBeInstanceOf(PDFSignature);
  });

  it('rejects unknown fields and answers of the wrong kind', async () => {
    expect(await rejects('clinic-registration.pdf', { 'not.a.field': text('x') })).toMatchObject({ code: 'FIELD_NOT_FOUND' });
    expect(await rejects('clinic-registration.pdf', { 'patient.fullName': box('checked') })).toMatchObject({ code: 'WRONG_ANSWER_KIND' });
    expect(await rejects('clinic-registration.pdf', { 'visit.firstVisit': text('yes') })).toMatchObject({ code: 'WRONG_ANSWER_KIND' });
    expect(await rejects('clinic-registration.pdf', { 'patient.fullName': choice('F') })).toMatchObject({ code: 'WRONG_ANSWER_KIND' });
    expect(await rejects('clinic-registration.pdf', { 'visit.firstVisit': choice('Yes') })).toMatchObject({ code: 'WRONG_ANSWER_KIND' });
  });

  it('a blank text answer leaves the field untouched', async () => {
    const before = await load(fixtureBytes('prefilled-field.pdf'));
    const out = await load(await fill('prefilled-field.pdf', { 'person.name': text('') }));
    expect(snapshot(out, 'person.name')).toBe(snapshot(before, 'person.name'));
  });

  it('is an instance of FillError for every field-level failure', async () => {
    expect(await rejects('clinic-registration.pdf', { nope: text('x') })).toBeInstanceOf(FillError);
  });
});

describe('prefilled fixture: replacing one field leaves the others exactly as they were', () => {
  it('replaces person.name only', async () => {
    const before = await load(fixtureBytes('prefilled-field.pdf'));
    const out = await load(await fill('prefilled-field.pdf', { 'person.name': text('REPLACEMENT TEST') }));
    expect(out.getForm().getTextField('person.name').getText()).toBe('REPLACEMENT TEST');
    for (const name of ['office.code', 'Text7', 'consent.contact', 'office.route']) {
      expect(snapshot(out, name), name).toBe(snapshot(before, name));
    }
    expect(out.getForm().getTextField('Text7').getText()).toBe('NO_AP_CANARY_3M8');
    expect(out.getForm().getDropdown('office.route').getSelected()).toEqual(['B']);
  });
});

describe('3pt padding in drawn appearances (fill PADDING, fixture spec appearance checks)', () => {
  /** x of every "x y Td" text position in a widget's appearance, and the clip box width. */
  /** x of every text line, from "1 0 0 1 x y Tm" (how pdf-lib places each line). */
  const textXs = (stream: string) => [...stream.matchAll(/1 0 0 1 (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) Tm/g)].map((m) => Number(m[1]));
  const widthOf = (out: Awaited<ReturnType<typeof load>>, name: string) => out.getForm().getField(name).acroField.getWidgets()[0]!.getRectangle().width;

  it.each([
    ['patient.fullName', text('LIN MEI TEST')],
    ['contact.address', text('Unit Ujian 8, Jalan Rekaan Ungu\nKawasan Rekaan')],
    ['contact.state', choice('SGR')],
  ] as const)('%s: every line starts at least 3pt in, and text is clipped 3pt inside every edge', async (name, answer) => {
    const out = await load(await fill('clinic-registration.pdf', { [name]: answer }));
    const field = out.getForm().getField(name);
    const [stream] = appearanceStreams(field);
    const xs = textXs(stream!);
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(3);
    // pdf-lib clips text to "padding" inside the box: the clip rectangle must keep 3pt too.
    // The clip path is the rectangle drawn just before "W": its corner must be at least 3pt in.
    const clip = stream!.match(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) m\n[^\n]+ l\n(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) l\n[^\n]+ l\nh\nW/);
    expect(clip).not.toBeNull();
    const [x1, y1, x2, y2] = [clip![1], clip![2], clip![3], clip![4]].map(Number) as [number, number, number, number];
    const rect = field.acroField.getWidgets()[0]!.getRectangle();
    expect(x1).toBeGreaterThanOrEqual(3);
    expect(y1).toBeGreaterThanOrEqual(3);
    expect(x2).toBeLessThanOrEqual(rect.width - 3);
    expect(y2).toBeLessThanOrEqual(rect.height - 3);
    expect(widthOf(out, name)).toBeGreaterThan(6);
  });

  it('a short value in a narrow field keeps its 10pt size and the 3pt start', async () => {
    // visit.shortCode is 100pt wide with MaxLen 4: four wide letters at 10pt fit inside the 94pt inner width.
    const out = await load(await fill('clinic-registration.pdf', { 'visit.shortCode': text('WWWW') }));
    const [stream] = appearanceStreams(out.getForm().getTextField('visit.shortCode'));
    expect(textXs(stream!)[0]).toBeGreaterThanOrEqual(3);
    expect(stream).toMatch(/\/\S+ 10 Tf/);
  });
});

describe('fonts', () => {
  it('chooses the first font that covers every character, and reports the first missing one', () => {
    expect(chooseFont([FULL_FONT], 'LUC\u00cdA P\u00c9REZ \u00d1')).toHaveProperty('source');
    expect(chooseFont([FULL_FONT], 'ok \u4e2d')).toEqual({ missing: 0x4e2d });
    expect(firstMissingCodePoint(FULL_FONT, 'line\none\r\n')).toBeUndefined();
    expect(chooseFont([], 'x')).toEqual({ missing: 0xfffd });
  });

  it('uses a later font when the first lacks a character', () => {
    const tiny = { id: 'tiny', bytes: FULL_FONT.bytes };
    expect(chooseFont([tiny, SUBSET_FONT], 'abc')).toMatchObject({ source: tiny });
  });

  it('writes accented US answers with the subsetted embedded font', async () => {
    const out = await load(await fill('us-community-clinic.pdf', { 'patient.fullName': text('LUC\u00cdA P\u00c9REZ TEST'), 'contact.city': text('A\u00f1o') }, [SUBSET_FONT]));
    expect(out.getForm().getTextField('patient.fullName').getText()).toBe('LUC\u00cdA P\u00c9REZ TEST');
    expect(out.getForm().getTextField('contact.city').getText()).toBe('A\u00f1o');
  });

  it('loadFont fetches once and shares the promise', async () => {
    clearLoadedFonts();
    let calls = 0;
    const ok = (async () => (calls++, new Response(new Uint8Array([1, 2, 3])))) as unknown as typeof fetch;
    const a = await loadFont('latin', ok);
    const b = await loadFont('latin', ok);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    expect(a).toMatchObject({ id: 'noto-latin' });
  });

  it('loadFont allows a retry after a failed download', async () => {
    clearLoadedFonts();
    const down = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(loadFont('latin', down)).rejects.toThrow('HTTP 503');
    const ok = (async () => new Response(new Uint8Array([9]))) as unknown as typeof fetch;
    await expect(loadFont('latin', ok)).resolves.toMatchObject({ id: 'noto-latin' });
    clearLoadedFonts();
  });
});

describe('field classes', () => {
  it('the fixtures use the field classes the fill code handles', async () => {
    const form = (await load(fixtureBytes('school-enrolment.pdf'))).getForm();
    expect(form.getField('admission.session')).toBeInstanceOf(PDFRadioGroup);
    expect(form.getField('admission.year')).toBeInstanceOf(PDFDropdown);
    expect(form.getField('consent.trip')).toBeInstanceOf(PDFCheckBox);
    expect(form.getField('student.name')).toBeInstanceOf(PDFTextField);
  });
});
