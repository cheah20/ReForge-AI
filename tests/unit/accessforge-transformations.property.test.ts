// @vitest-environment jsdom
/**
 * tests/unit/accessforge-transformations.property.test.ts
 *
 * accessforge-skeleton tasks 27.1 and 27.2 (Slice 2). 100 runs per property.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toIntendedValue, type MirrorAnswer } from '../../src/lib/accessforge/transformations.js';
import { daysInMonth, isValidCalendarDate, type DateFormat } from '../../src/packs/country/dates.js';
import { MY_IC_BIRTHPLACE_CODES } from '../../src/packs/country/my.js';
import type { PageEntry } from '../../src/shared/page-schemas.js';
import { MODEL } from './accessforge-helpers.js';

const RUNS = { numRuns: 100 };
const entryOf = (id: string): PageEntry => MODEL.entries.find((e) => e.elementId === id)!;
const dateEntry = (over: Partial<PageEntry> = {}): PageEntry => ({ ...entryOf('f0:text:tlahir'), ...over });
const pad = (n: number, w: number) => String(n).padStart(w, '0');

// Feature: accessforge-skeleton, Property 5: Date answers round-trip and invalid dates write nothing
describe('Property 5: date answers round-trip and invalid dates write nothing', () => {
  const FORMATS: DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
  const validDate = fc
    .record({ year: fc.integer({ min: 1, max: 9999 }), month: fc.integer({ min: 1, max: 12 }), dayPick: fc.nat() })
    .map(({ year, month, dayPick }) => ({ year, month, day: 1 + (dayPick % daysInMonth(month, year)) }));

  /** Splits the written date back into numbers by the format's own layout. */
  function split(text: string, format: DateFormat): { day: number; month: number; year: number } {
    const parts = text.split(/[/-]/).map(Number);
    if (format === 'DD/MM/YYYY') return { day: parts[0]!, month: parts[1]!, year: parts[2]! };
    if (format === 'MM/DD/YYYY') return { month: parts[0]!, day: parts[1]!, year: parts[2]! };
    return { year: parts[0]!, month: parts[1]!, day: parts[2]! };
  }

  it('a valid date written in the chosen format splits back to the same day, month and year', () => {
    fc.assert(
      fc.property(validDate, fc.constantFrom(...FORMATS), (d, format) => {
        const parts = { day: String(d.day), month: String(d.month), year: pad(d.year, 4) };
        const r = toIntendedValue(dateEntry(), 'date', { kind: 'date', parts }, { dateFormat: format });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(typeof r.intended).toBe('string');
        expect(split(r.intended as string, format)).toEqual(d);
      }),
      RUNS,
    );
  });

  const invalidParts = fc.oneof(
    // The date does not exist (day too big for the month, 29 February in a common year).
    fc.record({ year: fc.integer({ min: 1, max: 9999 }), month: fc.integer({ min: 1, max: 12 }), extra: fc.integer({ min: 1, max: 40 }) }).map(({ year, month, extra }) => ({
      day: String(daysInMonth(month, year) + extra),
      month: String(month),
      year: pad(year, 4),
    })),
    fc.record({ day: fc.constantFrom('0', '00'), month: fc.integer({ min: 1, max: 12 }).map(String), year: fc.integer({ min: 1, max: 9999 }).map((y) => pad(y, 4)) }),
    fc.record({ day: fc.integer({ min: 1, max: 28 }).map(String), month: fc.constantFrom('0', '13', '99'), year: fc.integer({ min: 1, max: 9999 }).map((y) => pad(y, 4)) }),
    // The year is not four digits.
    fc.record({ day: fc.integer({ min: 1, max: 28 }).map(String), month: fc.integer({ min: 1, max: 12 }).map(String), year: fc.oneof(fc.integer({ min: 0, max: 999 }).map(String), fc.integer({ min: 10000, max: 99999 }).map(String)) }),
  );

  it('an invalid combination gives no value', () => {
    fc.assert(
      fc.property(invalidParts, fc.constantFrom(...FORMATS), (parts, format) => {
        const r = toIntendedValue(dateEntry(), 'date', { kind: 'date', parts }, { dateFormat: format });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.messageKey).toBe('validation.date.invalid');
      }),
      RUNS,
    );
  });

  it('the shared calendar rule agrees: 29 February only in leap years', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), (year) => {
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        expect(isValidCalendarDate(29, 2, year)).toBe(leap);
        const r = toIntendedValue(dateEntry(), 'date', { kind: 'date', parts: { day: '29', month: '2', year: pad(year, 4) } }, { dateFormat: 'DD/MM/YYYY' });
        expect(r.ok).toBe(leap);
      }),
      RUNS,
    );
  });
});

// Feature: accessforge-skeleton, Property 6: Intended_Value equals the documented transformation
describe('Property 6: Intended_Value equals the documented transformation', () => {
  const TODAY = new Date(Date.UTC(2026, 10, 17));
  const nonBlank = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(s) && s.trim() === s.trim().normalize('NFC'));

  it('a name is trimmed and nothing else changes', () => {
    fc.assert(
      fc.property(nonBlank, fc.constantFrom('', ' ', '  ', '\t'), fc.constantFrom('', ' ', '  '), (name, lead, trail) => {
        const r = toIntendedValue(entryOf('f0:text:nama'), 'text', { kind: 'text', value: `${lead}${name}${trail}` }, { today: TODAY });
        expect(r).toMatchObject({ ok: true, transformation: 'trim', intended: name.trim() });
      }),
      RUNS,
    );
  });

  const validIc = fc
    .record({
      year: fc.integer({ min: 0, max: 99 }),
      month: fc.integer({ min: 1, max: 12 }),
      dayPick: fc.nat(),
      place: fc.constantFrom(...MY_IC_BIRTHPLACE_CODES),
      serial: fc.integer({ min: 0, max: 9999 }),
    })
    .map((p) => {
      const fullYear = p.year <= 26 ? 2000 + p.year : 1900 + p.year;
      const day = 1 + (p.dayPick % daysInMonth(p.month, fullYear));
      return `${pad(p.year, 2)}${pad(p.month, 2)}${pad(day, 2)}${p.place}${pad(p.serial, 4)}`;
    });

  it('an IC loses its separators and becomes twelve digits', () => {
    fc.assert(
      fc.property(validIc, fc.constantFrom('plain', 'dashes', 'spaces'), (digits, style) => {
        const typed = style === 'plain' ? digits : style === 'dashes' ? `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}` : `${digits.slice(0, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`;
        const r = toIntendedValue(entryOf('f0:text:nokp'), 'ic', { kind: 'text', value: typed }, { today: TODAY });
        expect(r).toMatchObject({ ok: true, transformation: 'ic-separators', intended: digits });
      }),
      RUNS,
    );
  });

  it('a postcode is its five digits, trimmed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 99999 }).map((n) => pad(n, 5)), fc.constantFrom('', ' ', '  '), (code, pad2) => {
        const r = toIntendedValue(entryOf('f0:text:poskod'), 'postcode', { kind: 'text', value: `${pad2}${code}${pad2}` }, { today: TODAY });
        if (r.ok) expect(r.intended).toBe(code);
        else expect(r.messageKey).toBe('validation.postcode.invalid');
      }),
      RUNS,
    );
  });

  it('a choice or the consent box is written unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom('L', 'P'), fc.constantFrom('PERIKSA', 'SUSULAN', 'VAKSIN', 'LAIN'), (gender, purpose) => {
        expect(toIntendedValue(entryOf('f0:radio:jantina'), 'radio', { kind: 'option', value: gender })).toMatchObject({ ok: true, intended: gender, transformation: 'none' });
        expect(toIntendedValue(entryOf('f0:select:tujuan'), 'dropdown', { kind: 'option', value: purpose })).toMatchObject({ ok: true, intended: purpose, transformation: 'none' });
        expect(toIntendedValue(entryOf('f0:checkbox:akuan'), 'checkbox', { kind: 'consent', checked: true })).toMatchObject({ ok: true, intended: true, transformation: 'none' });
      }),
      RUNS,
    );
  });

  it('a value that is not one of the page options is refused, never rewritten', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }).filter((s) => !['L', 'P'].includes(s) && s !== ''), (value) => {
        const answer: MirrorAnswer = { kind: 'option', value };
        expect(toIntendedValue(entryOf('f0:radio:jantina'), 'radio', answer).ok).toBe(false);
      }),
      RUNS,
    );
  });
});
