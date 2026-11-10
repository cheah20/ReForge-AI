/**
 * tests/unit/universal-pack.test.ts
 *
 * Unit tests for the universal country pack (task 6.3).
 * Tests: email, international phone acceptance, date parsing.
 */

import { describe, it, expect } from 'vitest';
import { universalPack, validateEmail } from '../../src/packs/country/universal.js';

// ---------------------------------------------------------------------------
// Email validation
// ---------------------------------------------------------------------------

describe('validateEmail', () => {
  it('accepts a valid email', () => {
    expect(validateEmail('user@example.com').valid).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(validateEmail('user@mail.example.com').valid).toBe(true);
  });

  it('accepts test fixture email', () => {
    expect(validateEmail('lin.mei@example.invalid').valid).toBe(true);
  });

  it('lowercases the normalized value', () => {
    const result = validateEmail('User@EXAMPLE.COM');
    expect(result.valid).toBe(true);
    expect(result.normalizedValue).toBe('user@example.com');
  });

  it('rejects email with no @', () => {
    expect(validateEmail('notanemail').valid).toBe(false);
  });

  it('rejects email with no TLD', () => {
    expect(validateEmail('user@example').valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateEmail('').valid).toBe(false);
  });

  it('rejects email with spaces', () => {
    expect(validateEmail('user @example.com').valid).toBe(false);
  });

  it('returns the correct message key on failure', () => {
    expect(validateEmail('bad').messageKey).toBe('validation.email.invalid');
  });
});

// ---------------------------------------------------------------------------
// Phone validation
// ---------------------------------------------------------------------------

describe('universalPack.validatePhone', () => {
  it('accepts an E.164 international number', () => {
    const r = universalPack.validatePhone('+12025550100');
    expect(r.valid).toBe(true);
  });

  it('accepts a Malaysian international number', () => {
    const r = universalPack.validatePhone('+60123456789');
    expect(r.valid).toBe(true);
  });

  // Review item 9: the old fallback accepted any string with 7+ digits.
  it('rejects text with letters, even when it contains 7+ digits', () => {
    const r = universalPack.validatePhone('garbage1234567');
    expect(r).toMatchObject({ valid: false, messageKey: 'validation.phone.invalid' });
    expect(r.needs).toBeUndefined();
  });

  it('asks for the country when a national number has no country context', () => {
    const r = universalPack.validatePhone('1234567');
    expect(r).toMatchObject({ valid: false, needs: 'country', messageKey: 'validation.phone.needsCountry' });
  });

  it('checks a national number against the given country', () => {
    expect(universalPack.validatePhone('012-345 6789', { country: 'MY' })).toMatchObject({
      valid: true,
      normalizedValue: '+60 12 345 6789',
    });
    expect(universalPack.validatePhone('(202) 555-0123', { country: 'US' }).valid).toBe(true);
  });

  it('rejects a national number that is not valid for the given country', () => {
    expect(universalPack.validatePhone('1234567', { country: 'MY' }).valid).toBe(false);
  });

  it('ignores an unsupported country hint and asks for the country instead', () => {
    expect(universalPack.validatePhone('0123456789', { country: 'ZZ' }).needs).toBe('country');
  });

  it('rejects too-short international input', () => {
    expect(universalPack.validatePhone('+12').valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Date parsing (universal — permissive)
// ---------------------------------------------------------------------------

describe('universalPack.validateDate — ISO format', () => {
  it('accepts 2026-11-09', () => {
    const r = universalPack.validateDate('2026-11-09', 'YYYY-MM-DD');
    expect(r.valid).toBe(true);
  });

  it('accepts leap year 2024-02-29', () => {
    const r = universalPack.validateDate('2024-02-29');
    expect(r.valid).toBe(true);
  });

  it('rejects century non-leap 2100-02-29', () => {
    const r = universalPack.validateDate('2100-02-29');
    expect(r.valid).toBe(false);
  });

  it('rejects century divisible by 400 is leap: 2000-02-29 passes', () => {
    const r = universalPack.validateDate('2000-02-29');
    expect(r.valid).toBe(true);
  });

  it('rejects invalid month 13', () => {
    const r = universalPack.validateDate('2026-13-01');
    expect(r.valid).toBe(false);
  });

  it('rejects April 31', () => {
    const r = universalPack.validateDate('2026-04-31');
    expect(r.valid).toBe(false);
  });
});

describe('universalPack.validateDate — DD/MM/YYYY format hint', () => {
  it('accepts 09/11/2026 as 9 November', () => {
    const r = universalPack.validateDate('09/11/2026', 'DD/MM/YYYY');
    expect(r.valid).toBe(true);
  });

  it('normalizes 09/11/2026 back to DD/MM/YYYY', () => {
    const r = universalPack.validateDate('09/11/2026', 'DD/MM/YYYY');
    expect(r.normalizedValue).toBe('09/11/2026');
  });
});

describe('universalPack.validateDate — MM/DD/YYYY format hint', () => {
  it('accepts 11/09/2026 as November 9', () => {
    const r = universalPack.validateDate('11/09/2026', 'MM/DD/YYYY');
    expect(r.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Postcode (universal — permissive)
// ---------------------------------------------------------------------------

describe('universalPack.validatePostcode', () => {
  it('accepts any non-empty string', () => {
    expect(universalPack.validatePostcode('12345').valid).toBe(true);
    expect(universalPack.validatePostcode('ABC DEF').valid).toBe(true);
  });

  it('rejects empty string', () => {
    expect(universalPack.validatePostcode('').valid).toBe(false);
  });
});
