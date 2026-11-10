/**
 * tests/unit/validate-answer.test.ts
 *
 * Review item 10 / decision 6: MaxLen applies to the normalized output, after
 * the pack has validated and normalized the answer, and answers are never cut.
 * Validates: Requirements 7.7, 7.9, 10.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { universalPack } from '../../src/packs/country/universal.js';
import { charCount, checkMaxLength, validateAnswer } from '../../src/packs/country/validate.js';

describe('MaxLen on the normalized value', () => {
  it('rejects when the raw input fits but the normalized value does not', () => {
    // "+60123456789" is 12 characters; normalized "+60 12 345 6789" is 15.
    const r = validateAnswer(universalPack, 'phone', '+60123456789', { maxLength: 13 });
    expect(r).toMatchObject({ valid: false, messageKey: 'validation.maxLength', messageParams: { max: 13 } });
  });

  it('accepts when the raw input is too long but the normalized value fits', () => {
    const r = validateAnswer(universalPack, 'postcode', '   43000   ', { maxLength: 5 });
    expect(r).toEqual({ valid: true, normalizedValue: '43000' });
  });

  it('accepts exactly MaxLen and rejects one over, without truncating', () => {
    expect(validateAnswer(universalPack, 'text', 'A123', { maxLength: 4 })).toEqual({ valid: true, normalizedValue: 'A123' });
    const over = validateAnswer(universalPack, 'text', 'ABCDE', { maxLength: 4 });
    expect(over.valid).toBe(false);
    expect(over.normalizedValue).toBeUndefined();
  });

  it('counts code points, not UTF-16 units', () => {
    expect(charCount('𠀋𠀋')).toBe(2);
    expect(validateAnswer(universalPack, 'text', '𠀋𠀋', { maxLength: 2 }).valid).toBe(true);
  });

  it('leaves invalid results untouched', () => {
    const invalid = { valid: false, messageKey: 'validation.email.invalid' };
    expect(checkMaxLength(invalid, 1)).toBe(invalid);
  });

  it('property: valid iff the normalized text is at most MaxLen characters', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), fc.integer({ min: 1, max: 30 }), (s, max) => {
        const r = validateAnswer(universalPack, 'text', s, { maxLength: max });
        const normalized = s.trim();
        if (normalized === '') return r.valid === true;
        return r.valid === charCount(normalized) <= max && (!r.valid || r.normalizedValue === normalized);
      }),
    );
  });
});

describe('required', () => {
  it('blocks a blank required answer and allows a blank optional one', () => {
    expect(validateAnswer(universalPack, 'text', '   ', { required: true })).toMatchObject({
      valid: false,
      messageKey: 'validation.required',
    });
    expect(validateAnswer(universalPack, 'text', '', {})).toEqual({ valid: true, normalizedValue: '' });
  });
});

describe('dispatch passes the form country to the phone validator', () => {
  it('uses the context country for national numbers', () => {
    expect(validateAnswer(universalPack, 'phone', '012-345 6789', {}, { country: 'MY' }).valid).toBe(true);
    expect(validateAnswer(universalPack, 'phone', '012-345 6789', {}, {}).needs).toBe('country');
  });
});
