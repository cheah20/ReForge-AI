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

  it('permissively accepts 7+ digits without country context', () => {
    const r = universalPack.validatePhone('1234567');
    expect(r.valid).toBe(true);
  });

  it('rejects too-short input', () => {
    const r = universalPack.validatePhone('12');
    expect(r.valid).toBe(false);
  });

  it('returns message key on failure', () => {
    const r = universalPack.validatePhone('12');
    expect(r.messageKey).toBe('validation.phone.invalid');
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
