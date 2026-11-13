/**
 * tests/unit/pack-pattern-exports.test.ts
 *
 * Country pack pattern exports for the Document_Path value rules V3 to V6 and
 * the V10 merge (formbridge-any-document task 2.7). The search patterns find a
 * value inside surrounding text and skip neighbouring strings that are not
 * that value. All values are synthetic.
 * Validates: Requirements 11.2, 11.11, 16.5
 */

import { describe, it, expect } from 'vitest';
import { MY_IC_PATTERN, MY_IC_SEARCH, normalizeIc, validateIc } from '../../src/packs/country/my.js';
import { US_SSN_SEARCH, validateSsn } from '../../src/packs/country/us.js';
import { EMAIL_SEARCH, validateEmail } from '../../src/packs/country/universal.js';
import { DATE_FORMAT_SEPARATORS, DATE_FORMATS } from '../../src/packs/country/dates.js';

const found = (re: RegExp, text: string) => text.match(re)?.[0] ?? null;

describe('MY_IC_PATTERN is the pattern the MY pack validates with', () => {
  it.each(['900101101234', '900101-10-1234', '900101 10 1234'])('matches %s anchored', (v) => {
    expect(MY_IC_PATTERN.test(v)).toBe(true);
    expect(normalizeIc(v)).toBe('900101101234');
  });

  it('is anchored: text around the number does not match', () => {
    expect(MY_IC_PATTERN.test('IC 900101101234')).toBe(false);
    expect(MY_IC_PATTERN.test('900101101234.')).toBe(false);
  });

  it('agrees with validateIc on shape', () => {
    expect(validateIc('900101-10-1234')).toEqual({ valid: true, normalizedValue: '900101101234' });
    expect(validateIc('90010110123')).toEqual({ valid: false, messageKey: 'validation.ic.wrongLength' });
  });
});

describe('MY_IC_SEARCH', () => {
  it.each([
    ['No. IC: 900101101234 (MyKad)', '900101101234'],
    ['IC900101-10-1234.', '900101-10-1234'],
    ['Kad pengenalan 900101 10 1234 sahaja', '900101 10 1234'],
  ])('finds the IC in %j', (text, value) => {
    expect(found(MY_IC_SEARCH, text)).toBe(value);
  });

  it.each([
    '9001011012345', // 13 digits: part of a longer number
    '19001011012345',
    '90010110123', // 11 digits
    '900101--10-1234', // two separators
    '9001-0101-1234', // separators in the wrong place
    'IC: ______________',
  ])('does not match %j', (text) => {
    expect(MY_IC_SEARCH.test(text)).toBe(false);
  });
});

describe('US_SSN_SEARCH', () => {
  it.each([
    ['SSN 123-45-6788 on file', '123-45-6788'],
    ['ssn:123456788;', '123456788'],
    ['Social Security 123 45 6788', '123 45 6788'],
  ])('finds the SSN in %j', (text, value) => {
    expect(found(US_SSN_SEARCH, text)).toBe(value);
  });

  it.each([
    '1234567889', // 10 digits
    '0123-45-6788', // a fourth leading digit
    '123-45-67889', // a fifth trailing digit
    '12-345-6788', // groups 2-3-4
    '123-45-678', // serial too short
  ])('does not match %j', (text) => {
    expect(US_SSN_SEARCH.test(text)).toBe(false);
  });

  it('covers both forms validateSsn accepts', () => {
    for (const v of ['123-45-6788', '123456788']) {
      expect(validateSsn(v).valid).toBe(true);
      expect(found(US_SSN_SEARCH, v)).toBe(v);
    }
  });
});

describe('EMAIL_SEARCH', () => {
  it.each([
    ['Contact name@example.invalid today', 'name@example.invalid'],
    ['email:first.last@mail.example.invalid', 'email:first.last@mail.example.invalid'],
  ])('finds the email in %j', (text, value) => {
    expect(found(EMAIL_SEARCH, text)).toBe(value);
  });

  it.each(['name@example', 'name@example.i', 'name at example.invalid', 'name@@example.invalid', '@example.invalid'])(
    'does not match %j',
    (text) => {
      expect(EMAIL_SEARCH.test(text)).toBe(false);
    },
  );

  it('finds every address validateEmail accepts', () => {
    for (const v of ['name@example.invalid', 'a.b+c@sub.example.invalid']) {
      expect(validateEmail(v).valid).toBe(true);
      expect(found(EMAIL_SEARCH, v)).toBe(v);
    }
  });
});

describe('DATE_FORMAT_SEPARATORS', () => {
  it('are exactly the separators of DATE_FORMATS', () => {
    expect(DATE_FORMATS).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']);
    expect(DATE_FORMAT_SEPARATORS).toEqual(['/', '-']);
  });
});
