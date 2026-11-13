// @vitest-environment jsdom
/**
 * tests/unit/accessforge-transformations-examples.test.ts
 *
 * accessforge-skeleton task 10.3: the per-field table of design Question 8,
 * date examples and the legacy date-format rule.
 * Validates: Requirements 9.7, 9.10, 9.11, 15.4, 15.5, 15.6
 */

import { describe, it, expect } from 'vitest';
import { extractPageModel } from '../../src/lib/accessforge/extract.js';
import { CONSENT_REQUIRED_KEY, detectLegacyDateFormat, legacyLength, toIntendedValue, type MirrorAnswer } from '../../src/lib/accessforge/transformations.js';
import { TEMPLATES, PAGE_VERSIONS } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import type { PageEntry, PageModel } from '../../src/shared/page-schemas.js';
import type { AnswerType } from '../../src/shared/types.js';

const r = extractPageModel(new DOMParser().parseFromString(fill(TEMPLATES.register, {}), 'text/html'), PAGE_VERSIONS.register);
if (!r.ok) throw new Error('registration page did not extract');
const MODEL: PageModel = r.model;
const entry = (name: string): PageEntry => MODEL.entries.find((e) => e.name === name)!;
const TODAY = new Date(Date.UTC(2026, 10, 17));

const TABLE: Array<[string, AnswerType, MirrorAnswer, string | boolean, string]> = [
  ['nama', 'text', { kind: 'text', value: '  LIN MEI TEST ' }, 'LIN MEI TEST', 'trim'],
  ['nokp', 'ic', { kind: 'text', value: '900101-10-1234' }, '900101101234', 'ic-separators'],
  ['tlahir', 'date', { kind: 'date', parts: { day: '1', month: '1', year: '1990' } }, '01/01/1990', 'date-format'],
  ['jantina', 'radio', { kind: 'option', value: 'P' }, 'P', 'none'],
  ['tel', 'phone', { kind: 'text', value: '+60 11-2345 6789' }, '011-2345 6789', 'my-phone-grouping'],
  ['poskod', 'postcode', { kind: 'text', value: '43000' }, '43000', 'trim'],
  ['tujuan', 'dropdown', { kind: 'option', value: 'PERIKSA' }, 'PERIKSA', 'none'],
  ['akuan', 'checkbox', { kind: 'consent', checked: true }, true, 'none'],
];

describe('the per-field table of design Question 8', () => {
  it.each(TABLE)('%s', (name, type, answer, intended, transformation) => {
    expect(toIntendedValue(entry(name), type, answer, { today: TODAY })).toEqual({ ok: true, intended, transformation });
  });

  it('every written string fits its maxlength, so the handler accepts it', () => {
    for (const [name, type, answer] of TABLE) {
      const res = toIntendedValue(entry(name), type, answer, { today: TODAY });
      const max = entry(name).maxLength;
      if (res.ok && typeof res.intended === 'string' && max !== null) expect(legacyLength(res.intended)).toBeLessThanOrEqual(max);
    }
  });

  it('rejects the wrongly typed IC of the acceptance test with the IC date message', () => {
    expect(toIntendedValue(entry('nokp'), 'ic', { kind: 'text', value: '901301-10-1234' }, { today: TODAY })).toEqual({
      ok: false,
      messageKey: 'validation.ic.invalidDate',
    });
  });
});

describe('dates', () => {
  const date = (day: string, month: string, year: string) => toIntendedValue(entry('tlahir'), 'date', { kind: 'date', parts: { day, month, year } });

  it.each([
    ['1', '1', '1990', '01/01/1990'],
    ['29', '2', '2000', '29/02/2000'],
    [' 05 ', '12', '2001', '05/12/2001'],
  ])('accepts %s/%s/%s', (d, m, y, intended) => {
    expect(date(d, m, y)).toEqual({ ok: true, intended, transformation: 'date-format' });
  });

  it.each([
    ['29 February in a common year', '29', '2', '1990'],
    ['day 32', '32', '1', '1990'],
    ['month 13', '1', '13', '1990'],
    ['day 0', '0', '1', '1990'],
    ['a two-digit year', '1', '1', '90'],
    ['a letter in the day', '1a', '1', '1990'],
    ['a negative month', '1', '-1', '1990'],
    ['a missing part', '1', '', '1990'],
  ])('rejects %s with no value', (_label, d, m, y) => {
    expect(date(d, m, y)).toEqual({ ok: false, messageKey: 'validation.date.invalid' });
  });

  it('rejects an empty required date as required', () => {
    expect(date('', '', '')).toEqual({ ok: false, messageKey: 'validation.required' });
  });

  it('writes in the format the user chose when the page states none', () => {
    const plain: PageEntry = { ...entry('tlahir'), nearbyText: '' };
    const parts = { day: '1', month: '2', year: '1990' };
    expect(toIntendedValue(plain, 'date', { kind: 'date', parts })).toEqual({ ok: false, needs: 'format', messageKey: 'validation.date.chooseFormat' });
    expect(toIntendedValue(plain, 'date', { kind: 'date', parts }, { dateFormat: 'YYYY-MM-DD' })).toEqual({ ok: true, intended: '1990-02-01', transformation: 'date-format' });
  });
});

describe('detectLegacyDateFormat', () => {
  const at = (texts: Partial<Pick<PageEntry, 'labelText' | 'neighbourText' | 'nearbyText'>>): PageEntry => ({
    ...entry('tlahir'),
    labelText: '',
    neighbourText: '',
    nearbyText: '',
    ...texts,
  });

  it('reads HH/BB/TTTT as DD/MM/YYYY, on the real page and in any letter case', () => {
    expect(entry('tlahir').nearbyText).toBe('(hh/bb/tttt)');
    expect(detectLegacyDateFormat(entry('tlahir'))).toBe('DD/MM/YYYY');
    expect(detectLegacyDateFormat(at({ neighbourText: 'Tarikh (HH/BB/TTTT)' }))).toBe('DD/MM/YYYY');
  });

  it('uses the shared detector for the English patterns', () => {
    expect(detectLegacyDateFormat(at({ labelText: 'Date (YYYY-MM-DD)' }))).toBe('YYYY-MM-DD');
  });

  it('agrees when two texts state the same format', () => {
    expect(detectLegacyDateFormat(at({ labelText: 'DD/MM/YYYY', nearbyText: 'hh/bb/tttt' }))).toBe('DD/MM/YYYY');
  });

  it('returns ambiguous when two different formats are stated', () => {
    expect(detectLegacyDateFormat(at({ neighbourText: 'MM/DD/YYYY', nearbyText: '(hh/bb/tttt)' }))).toBe('ambiguous');
  });

  it('returns undefined when no format is stated, and the ambiguous page asks the user', () => {
    expect(detectLegacyDateFormat(at({}))).toBeUndefined();
    const ambiguous = at({ neighbourText: 'MM/DD/YYYY', nearbyText: '(hh/bb/tttt)' });
    expect(toIntendedValue(ambiguous, 'date', { kind: 'date', parts: { day: '1', month: '2', year: '1990' } })).toMatchObject({ ok: false, needs: 'format' });
  });
});

describe('options and consent', () => {
  it('writes only a Page_Model option value', () => {
    expect(toIntendedValue(entry('tujuan'), 'dropdown', { kind: 'option', value: 'Pemeriksaan am' })).toEqual({ ok: false, messageKey: 'validation.dropdown.invalid' });
    expect(toIntendedValue(entry('jantina'), 'radio', { kind: 'option', value: 'X' })).toEqual({ ok: false, messageKey: 'validation.radio.invalid' });
    expect(toIntendedValue(entry('tujuan'), 'dropdown', { kind: 'option', value: '' })).toEqual({ ok: false, messageKey: 'validation.required' });
  });

  it('refuses an unticked consent box on the required consent field', () => {
    expect(toIntendedValue(entry('akuan'), 'checkbox', { kind: 'consent', checked: false })).toEqual({ ok: false, messageKey: CONSENT_REQUIRED_KEY });
  });

  it('throws on an answer kind that does not match the field, instead of guessing', () => {
    expect(() => toIntendedValue(entry('nama'), 'text', { kind: 'option', value: 'P' })).toThrow(TypeError);
    expect(() => toIntendedValue(entry('tujuan'), 'text', { kind: 'text', value: 'x' })).toThrow(TypeError);
  });
});
