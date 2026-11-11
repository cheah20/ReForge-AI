/**
 * tests/unit/dates.test.ts
 *
 * Tasks 24.1 and 24.4: dates are checked only against a confirmed or printed
 * format; day and month are never swapped or guessed.
 * Validates: Requirement 7.5 (decision 9, review 1 item 19)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DATE_FORMATS, detectDateFormat, isValidCalendarDate, validateDateAnswer, type DateFormat } from '../../src/packs/country/dates.js';
import { resolveDateFormat, validateAnswer } from '../../src/packs/country/validate.js';
import { myPack } from '../../src/packs/country/my.js';
import { usPack } from '../../src/packs/country/us.js';
import { universalPack } from '../../src/packs/country/universal.js';

describe('no format known: ask, never guess', () => {
  it.each(['03/04/2026', '12/31/2026', '31/12/2026', '2026-11-17', 'tomorrow'])('%s needs a confirmed format', (value) => {
    expect(validateDateAnswer(value, undefined)).toEqual({ valid: false, needs: 'format', messageKey: 'validation.date.chooseFormat' });
  });

  it('12/31/2026 is not rejected just because day-first parsing fails: it waits for the format', () => {
    const r = validateAnswer(universalPack, 'date', '12/31/2026', {});
    expect(r.needs).toBe('format');
    expect(r.messageKey).not.toBe('validation.date.invalid');
    // Once MM/DD/YYYY is confirmed, it is a real date.
    expect(validateAnswer(universalPack, 'date', '12/31/2026', { dateFormat: 'MM/DD/YYYY' })).toEqual({ valid: true, normalizedValue: '12/31/2026' });
  });

  it('03/04/2026 means different dates under different confirmed formats, and is never swapped', () => {
    expect(validateDateAnswer('03/04/2026', 'DD/MM/YYYY').normalizedValue).toBe('03/04/2026');
    expect(validateDateAnswer('03/04/2026', 'MM/DD/YYYY').normalizedValue).toBe('03/04/2026');
    expect(validateDateAnswer('03/04/2026', 'YYYY-MM-DD')).toMatchObject({ valid: false, messageKey: 'validation.date.wrongFormat' });
  });
});

describe('parsing only the confirmed format', () => {
  it('converts ISO input to the field format (fixture acceptance answers)', () => {
    expect(validateDateAnswer('1990-01-01', 'DD/MM/YYYY')).toEqual({ valid: true, normalizedValue: '01/01/1990' });
    expect(validateDateAnswer('2026-11-17', 'DD/MM/YYYY')).toEqual({ valid: true, normalizedValue: '17/11/2026' });
    expect(validateDateAnswer('1992-02-03', 'MM/DD/YYYY')).toEqual({ valid: true, normalizedValue: '02/03/1992' });
    expect(validateDateAnswer('2026-12-01', 'MM/DD/YYYY')).toEqual({ valid: true, normalizedValue: '12/01/2026' });
    expect(validateDateAnswer('2018-04-05', 'YYYY-MM-DD')).toEqual({ valid: true, normalizedValue: '2018-04-05' });
  });

  it('a day-first value on a month-first form is invalid, not swapped', () => {
    expect(validateDateAnswer('31/12/2026', 'MM/DD/YYYY')).toEqual({ valid: false, messageKey: 'validation.date.invalid' });
    expect(validateDateAnswer('12/31/2026', 'DD/MM/YYYY')).toEqual({ valid: false, messageKey: 'validation.date.invalid' });
  });

  it.each([
    ['29/02/2024', 'DD/MM/YYYY', true],
    ['02/29/2024', 'MM/DD/YYYY', true],
    ['2000-02-29', 'YYYY-MM-DD', true],
    ['1900-02-29', 'YYYY-MM-DD', false],
    ['2100-02-29', 'YYYY-MM-DD', false],
    ['2023-02-29', 'YYYY-MM-DD', false],
    ['31/04/2026', 'DD/MM/YYYY', false],
    ['04/31/2026', 'MM/DD/YYYY', false],
    ['2026-13-01', 'YYYY-MM-DD', false],
    ['2026-02-30', 'DD/MM/YYYY', false], // fixture rejection variant
    ['0000-01-01', 'YYYY-MM-DD', false], // year 0000 is outside the application profile
    ['2027-01-01', 'YYYY-MM-DD', true], // future dates are not a format error
  ] as const)('%s on a %s form: valid=%s', (value, format, valid) => {
    expect(validateDateAnswer(value, format).valid).toBe(valid);
  });

  it.each([
    ['9/11/2026', 'DD/MM/YYYY'], // missing zero padding
    ['2026/11/09', 'YYYY-MM-DD'], // wrong separator
    ['09-11-2026', 'DD/MM/YYYY'],
    ['9 Nov 2026', 'DD/MM/YYYY'],
  ] as const)('rejects the layout of %s with an example of %s', (value, format) => {
    const r = validateDateAnswer(value, format);
    expect(r).toMatchObject({ valid: false, messageKey: 'validation.date.wrongFormat' });
    expect(r.messageParams).toMatchObject({ format });
    expect(String(r.messageParams?.['example'])).toMatch(format === 'YYYY-MM-DD' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('where the format comes from', () => {
  it('detects one printed pattern and ignores ambiguous text', () => {
    expect(detectDateFormat('Tarikh lahir dalam format DD/MM/YYYY')).toBe('DD/MM/YYYY');
    expect(detectDateFormat('Date of birth, MM/DD/YYYY')).toBe('MM/DD/YYYY');
    expect(detectDateFormat('dd/mm/yyyy')).toBe('DD/MM/YYYY');
    expect(detectDateFormat('Tarikh lawatan')).toBeUndefined();
    expect(detectDateFormat('DD/MM/YYYY or MM/DD/YYYY')).toBeUndefined();
    expect(detectDateFormat(undefined)).toBeUndefined();
  });

  it('the user’s confirmed choice wins over a printed pattern; tooltip wins over page text', () => {
    expect(resolveDateFormat({ dateFormat: 'YYYY-MM-DD', tooltip: 'DD/MM/YYYY' })).toBe('YYYY-MM-DD');
    expect(resolveDateFormat({ tooltip: 'DD/MM/YYYY', pageText: 'MM/DD/YYYY' })).toBe('DD/MM/YYYY');
    expect(resolveDateFormat({ pageText: 'Tarikh Lahir (DD/MM/YYYY)' })).toBe('DD/MM/YYYY');
    expect(resolveDateFormat({ pageText: 'Tarikh lawatan' })).toBeUndefined();
  });

  it('the MaxLen check applies to the formatted date (requirement 7.5)', () => {
    // Fixture variant: a DD/MM/YYYY field with MaxLen 8 cannot hold the 10-character result.
    expect(validateAnswer(myPack, 'date', '2026-11-17', { dateFormat: 'DD/MM/YYYY', maxLength: 8 })).toMatchObject({
      valid: false,
      messageKey: 'validation.maxLength',
    });
  });

  it('pack defaults are only suggestions to pre-select', () => {
    expect(myPack.defaultDateFormat).toBe('DD/MM/YYYY');
    expect(usPack.defaultDateFormat).toBe('MM/DD/YYYY');
    expect(universalPack.defaultDateFormat).toBe('YYYY-MM-DD');
    expect(validateAnswer(usPack, 'date', '12/01/2026', {}).needs).toBe('format');
  });
});

describe('date properties', () => {
  const two = (n: number) => String(n).padStart(2, '0');
  const anyDate = fc.date({ min: new Date(1, 0, 1), max: new Date(9999, 11, 31), noInvalidDate: true });

  it('every real date, typed as ISO, comes back in the field format and round-trips', () => {
    fc.assert(
      fc.property(anyDate, fc.constantFrom(...DATE_FORMATS), (d, format: DateFormat) => {
        const [y, m, day] = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
        if (y < 1) return;
        const iso = `${String(y).padStart(4, '0')}-${two(m)}-${two(day)}`;
        const r = validateDateAnswer(iso, format);
        expect(r.valid, iso).toBe(true);
        // Feeding the output back in gives the same output.
        expect(validateDateAnswer(r.normalizedValue!, format).normalizedValue).toBe(r.normalizedValue);
      }),
      { numRuns: 500 },
    );
  });

  it('isValidCalendarDate agrees with the JavaScript Date object for every day, month and year', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 32 }), fc.integer({ min: 0, max: 13 }), fc.integer({ min: 1, max: 9999 }), (day, month, year) => {
        const d = new Date(2000, 0, 1);
        d.setFullYear(year, month - 1, day);
        const real = month >= 1 && month <= 12 && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
        expect(isValidCalendarDate(day, month, year)).toBe(real);
      }),
      { numRuns: 2000 },
    );
  });
});
