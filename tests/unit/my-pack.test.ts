/**
 * tests/unit/my-pack.test.ts
 *
 * Task 22: the Malaysia pack. Synthetic values only (format checks; none of
 * these numbers is claimed to be issued or in service).
 * - IC number: Validates Requirement 7.1, 8.3 (Properties 3 and 4)
 * - Phone: Validates Requirement 7.2, 8.4
 * - Postcode: Validates Requirement 7.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  icDateIsValid,
  MY_IC_BIRTHPLACE_CODES,
  MY_PHONE_PLAN,
  myPack,
  normalizeIc,
  validateIc,
  validateMyPhone,
  validateMyPostcode,
} from '../../src/packs/country/my.js';
import { getCountryPack, registeredCountries } from '../../src/packs/country/registry.js';
import { validateAnswer } from '../../src/packs/country/validate.js';

/** Fixed "today" so century tests do not depend on the run date. */
const TODAY = new Date(2026, 10, 11); // 11 November 2026
const ic = (v: string) => validateIc(v, { today: TODAY });

describe('birthplace codes (decision 1)', () => {
  it('lists exactly the JPN codes', () => {
    const expected = [
      ...Array.from({ length: 16 }, (_, i) => i + 1),
      ...Array.from({ length: 39 }, (_, i) => i + 21),
      ...Array.from({ length: 9 }, (_, i) => i + 60),
      71, 72,
      ...Array.from({ length: 6 }, (_, i) => i + 74),
      ...Array.from({ length: 12 }, (_, i) => i + 82),
      98, 99,
    ].map((n) => String(n).padStart(2, '0'));
    expect([...MY_IC_BIRTHPLACE_CODES].sort()).toEqual(expected.sort());
  });

  it('leaves out the unlisted codes', () => {
    for (const code of ['00', '17', '18', '19', '20', '69', '70', '73', '80', '81', '94', '95', '96', '97']) {
      expect(MY_IC_BIRTHPLACE_CODES.has(code), code).toBe(false);
    }
  });
});

describe('IC number (task 22.4)', () => {
  it.each([
    ['900101-01-1234', '900101011234'],
    ['900101011234', '900101011234'],
    ['900101-59-1234', '900101591234'],
    ['900101-71-1234', '900101711234'],
    ['900101-82-1234', '900101821234'],
    ['900101-98-1234', '900101981234'],
    ['900101-01-1235', '900101011235'], // no checksum: the last digit is not tested
    ['900101-10-1234', '900101101234'], // fixture acceptance answer
    ['851231 14 5678', '851231145678'],
    ['010101-16-0001', '010101160001'],
    ['  750615-12-3456  ', '750615123456'],
    ['240229-13-9999', '240229139999'], // 2024 is a leap year
  ])('accepts %s as %s', (input, normalized) => {
    expect(ic(input)).toEqual({ valid: true, normalizedValue: normalized });
  });

  it.each([
    ['991332-10-1234', 'validation.ic.invalidDate'], // month 13 (fixture acceptance)
    ['901301-01-1234', 'validation.ic.invalidDate'],
    ['900132-01-1234', 'validation.ic.invalidDate'], // day 32
    ['900431-01-1234', 'validation.ic.invalidDate'], // 31 April
    ['900101-17-1234', 'validation.ic.invalidBirthplace'],
    ['900101-00-1234', 'validation.ic.invalidBirthplace'],
    ['900101-01-123', 'validation.ic.wrongLength'],
    ['900101-01-12345', 'validation.ic.wrongLength'],
    ['900101-0A-1234', 'validation.ic.wrongLength'],
    ['9001-0101-1234', 'validation.ic.wrongLength'], // separators in the wrong place
    ['', 'validation.ic.wrongLength'],
  ])('rejects %s with %s', (input, messageKey) => {
    expect(ic(input)).toEqual({ valid: false, messageKey });
  });

  it('a 20YY date later than today is retried as 19YY (requirement 7.1)', () => {
    // 2099-12-31 is in the future, 1999-12-31 is a real date: accepted.
    expect(ic('991231-10-1234').valid).toBe(true);
    // 2030-01-01 is in the future, 1930-01-01 is real: accepted.
    expect(ic('300101-10-1234').valid).toBe(true);
  });

  it('a future 20YY date whose 19YY version does not exist is rejected', () => {
    // On 1 Jan 2000, 2000-02-29 is still in the future and 1900 is not a leap year.
    expect(validateIc('000229-01-1234', { today: new Date(2000, 0, 1) })).toEqual({
      valid: false,
      messageKey: 'validation.ic.invalidDate',
    });
    // Once 2000-02-29 has passed, the same number is accepted as 2000.
    expect(validateIc('000229-01-1234', { today: new Date(2000, 2, 1) }).valid).toBe(true);
  });

  it('today itself counts as not later than today', () => {
    expect(icDateIsValid('261111', TODAY)).toBe(true);
    expect(icDateIsValid('261112', new Date(2026, 10, 11, 23, 59))).toBe(true); // falls back to 1926-11-12
    expect(icDateIsValid('260229', TODAY)).toBe(false); // neither 2026 nor 1926 is a leap year
  });

  it('never returns an age or birth year', () => {
    expect(Object.keys(ic('900101-10-1234')).sort()).toEqual(['normalizedValue', 'valid']);
  });

  it('fits a MaxLen 12 field because MaxLen applies to the normalized value (decision 6)', () => {
    expect(validateAnswer(myPack, 'ic', '900101-10-1234', { maxLength: 12 }, { today: TODAY })).toEqual({
      valid: true,
      normalizedValue: '900101101234',
    });
  });
});

describe('phone (task 22.5)', () => {
  it.each([
    ['010-234 5678', '010-234 5678'],
    ['011-2345 6789', '011-2345 6789'],
    ['012-345 6789', '012-345 6789'],
    ['013-234 5678', '013-234 5678'],
    ['014-234 5678', '014-234 5678'],
    ['015-2345 6789', '015-2345 6789'], // provisional
    ['016-234 5678', '016-234 5678'],
    ['017-234 5678', '017-234 5678'],
    ['018-234 5678', '018-234 5678'],
    ['019-234 5678', '019-234 5678'],
    ['03-2345 6789', '03-2345 6789'], // Klang Valley
    ['04-123 4567', '04-123 4567'],
    ['05-123 4567', '05-123 4567'],
    ['06-123 4567', '06-123 4567'],
    ['07-123 4567', '07-123 4567'],
    ['09-123 4567', '09-123 4567'],
    ['082-123 456', '082-123 456'], // Sarawak
    ['083-123 456', '083-123 456'],
    ['084-123 456', '084-123 456'],
    ['085-123 456', '085-123 456'],
    ['086-123 456', '086-123 456'],
    ['087-123 456', '087-123 456'],
    ['088-123 456', '088-123 456'],
    ['089-123 456', '089-123 456'],
  ])('accepts %s and writes %s', (input, out) => {
    expect(validateMyPhone(input)).toEqual({ valid: true, normalizedValue: out });
  });

  it.each([
    ['+601123456789', '011-2345 6789'], // fixture acceptance answer
    ['60323456789', '03-2345 6789'], // fixture acceptance answer
    ['+60123456789', '012-345 6789'], // fixture acceptance answer
    ['+60 12 345 6789', '012-345 6789'],
    ['60123456789', '012-345 6789'],
    ['0123456789', '012-345 6789'],
    ['(012) 345-6789', '012-345 6789'],
    ['  012 3456789 ', '012-345 6789'],
  ])('accepts %s in any grouping and writes %s', (input, out) => {
    expect(validateMyPhone(input)).toEqual({ valid: true, normalizedValue: out });
  });

  it.each([
    '011-123 4567', // 011 needs 8 digits
    '012-1234 5678', // 012 needs 7 digits
    '03-123 4567', // 03 needs 8 digits
    '082-1234 5678', // 082 needs 6 digits
    '+60 012 345 6789', // trunk zero kept after +60
    '600123456789',
    '02-123 4567', // no 02 area code
    '080-123 456',
    '081-123 456',
    '123456789', // no trunk 0 and no country code
    '+1 202 555 0100', // not a Malaysian number
    '012.345.6789', // dots are not a documented separator
    '012-345 678x',
    '+',
    '',
  ])('rejects %s', (input) => {
    expect(validateMyPhone(input)).toEqual({ valid: false, messageKey: 'validation.phone.invalid' });
  });

  it('marks the unverified rows of the numbering plan as provisional', () => {
    const provisional = Object.entries(MY_PHONE_PLAN).filter(([, p]) => p.provisional).map(([k]) => k);
    expect(provisional).toContain('15');
    expect(provisional).toContain('3');
    expect(provisional).not.toContain('12');
  });

  it('the written values fit the clinic form MaxLen of 13 and 12', () => {
    expect(validateAnswer(myPack, 'phone', '+601123456789', { maxLength: 13 }).valid).toBe(true);
    expect(validateAnswer(myPack, 'phone', '60323456789', { maxLength: 12 }).valid).toBe(true);
  });
});

describe('postcode (task 22.6)', () => {
  it.each(['43000', '01000', '00000', ' 50450 '])('accepts %s', (input) => {
    expect(validateMyPostcode(input)).toEqual({ valid: true, normalizedValue: input.trim() });
  });

  it.each(['1000', '430000', '43A00', '43 000', '4300O', '４３０００', ''])('rejects %s', (input) => {
    expect(validateMyPostcode(input)).toEqual({ valid: false, messageKey: 'validation.postcode.my.invalid' });
  });
});

describe('registry', () => {
  it('serves the MY pack for MY in any case, and the universal pack for other countries', () => {
    expect(getCountryPack('MY')).toBe(myPack);
    expect(getCountryPack(' my ')).toBe(myPack);
    expect(getCountryPack('SG').code).toBe('universal');
    expect(registeredCountries()).toContain('MY');
  });

  it('validateAnswer routes postcode and IC answers to the MY rules', () => {
    expect(validateAnswer(myPack, 'postcode', '4300')).toMatchObject({ valid: false, messageKey: 'validation.postcode.my.invalid' });
    expect(validateAnswer(myPack, 'ic', '900101-17-1234', {}, { today: TODAY })).toMatchObject({
      messageKey: 'validation.ic.invalidBirthplace',
    });
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const two = (n: number) => String(n).padStart(2, '0');
const CODES = [...MY_IC_BIRTHPLACE_CODES];
const UNLISTED = Array.from({ length: 100 }, (_, i) => two(i)).filter((c) => !MY_IC_BIRTHPLACE_CODES.has(c));

/** A real calendar date between 1901 and today, as YYMMDD. */
const pastDate = fc.date({ min: new Date(1901, 0, 1), max: TODAY, noInvalidDate: true }).map(
  (d) => `${two(d.getFullYear() % 100)}${two(d.getMonth() + 1)}${two(d.getDate())}`,
);
const separator = fc.constantFrom('', '-', ' ');

describe('Property 3: IC normalization idempotence (Validates: Requirements 7.1, 8.3)', () => {
  it('for any accepted IC, normalizing twice equals normalizing once, and gives 12 digits', () => {
    fc.assert(
      fc.property(pastDate, fc.constantFrom(...CODES), fc.stringMatching(/^\d{4}$/), separator, separator, (date, code, tail, s1, s2) => {
        const input = `${date}${s1}${code}${s2}${tail}`;
        const result = ic(input);
        expect(result.valid, input).toBe(true);
        const once = normalizeIc(input);
        expect(normalizeIc(once)).toBe(once);
        expect(once).toMatch(/^\d{12}$/);
        expect(result.normalizedValue).toBe(once);
      }),
      { numRuns: 300 },
    );
  });
});

/** Independent oracle using the JavaScript Date object, not the pack's calendar code. */
function realDate(y: number, m: number, d: number): Date | undefined {
  const date = new Date(y, m - 1, d);
  date.setFullYear(y);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
}

function oracle(digits: string, today: Date): boolean {
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const in2000s = realDate(2000 + yy, mm, dd);
  const dateOk = (in2000s !== undefined && in2000s <= midnight) || realDate(1900 + yy, mm, dd) !== undefined;
  return dateOk && MY_IC_BIRTHPLACE_CODES.has(digits.slice(6, 8));
}

describe('Property 4: IC validation correctness (Validates: Requirement 7.1)', () => {
  it('a 12-digit string is valid iff its date passes the century rule and its birthplace code is listed', () => {
    const anyDigits = fc.stringMatching(/^\d{12}$/);
    // Each condition can fail on its own: good date + unlisted code, bad date + listed code, both good.
    const goodDateBadCode = fc
      .tuple(pastDate, fc.constantFrom(...UNLISTED), fc.stringMatching(/^\d{4}$/))
      .map(([d, c, t]) => d + c + t);
    const badDateGoodCode = fc
      .tuple(fc.stringMatching(/^\d{2}$/), fc.constantFrom('00', '13', '19', '02'), fc.constantFrom('00', '30', '31', '32', '29'), fc.constantFrom(...CODES), fc.stringMatching(/^\d{4}$/))
      .map(([y, m, d, c, t]) => y + m + d + c + t);
    const allGood = fc.tuple(pastDate, fc.constantFrom(...CODES), fc.stringMatching(/^\d{4}$/)).map(([d, c, t]) => d + c + t);

    const seen = { valid: 0, badDate: 0, badCode: 0 };
    fc.assert(
      fc.property(fc.oneof(anyDigits, goodDateBadCode, badDateGoodCode, allGood), (digits) => {
        const result = ic(digits);
        const expected = oracle(digits, TODAY);
        expect(result.valid, digits).toBe(expected);
        if (result.valid) seen.valid++;
        else if (result.messageKey === 'validation.ic.invalidDate') seen.badDate++;
        else if (result.messageKey === 'validation.ic.invalidBirthplace') seen.badCode++;
      }),
      { numRuns: 1000 },
    );
    // The generator reached every outcome, so the property could have failed on each condition.
    expect(seen.valid).toBeGreaterThan(0);
    expect(seen.badDate).toBeGreaterThan(0);
    expect(seen.badCode).toBeGreaterThan(0);
  });
});
