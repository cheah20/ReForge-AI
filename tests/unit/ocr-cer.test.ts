/**
 * tests/unit/ocr-cer.test.ts
 *
 * The character error rate helper and the OCR_Validation_Bar (task 3.2).
 * Validates: Requirement 9.1
 */

import { describe, it, expect } from 'vitest';
import { cer, levenshtein, normalizeForCer, validationBar } from '../ocr/cer.js';

describe('character error rate', () => {
  it('is 0 for an exact match and after whitespace and NFKC normalisation', () => {
    expect(cer('Full name:', 'Full name:')).toBe(0);
    expect(cer('Full name:', '  Full   name: ')).toBe(0);
    // Full-width colon folds to ":" under NFKC.
    expect(cer('Full name:', 'Full name\uff1a')).toBe(0);
  });

  it('counts one substitution, insertion or deletion as one error over the expected length', () => {
    expect(cer('Postcode:', 'Postc0de:')).toBeCloseTo(1 / 9);
    expect(cer('Email:', 'Emaill:')).toBeCloseTo(1 / 6);
    expect(cer('Email:', 'Emil:')).toBeCloseTo(1 / 6);
  });

  it('is 1 for an empty result and counts code points, not UTF-16 units', () => {
    expect(cer('Phone:', '')).toBe(1);
    expect(cer('', '')).toBe(0);
    expect(levenshtein('\u{20000}a', 'a')).toBe(1);
    expect(normalizeForCer('a\u00a0\tb')).toBe('a b');
  });
});

describe('OCR_Validation_Bar', () => {
  // Labels far apart from each other, so a missing one cannot match a neighbour.
  const labels = ['Full name:', 'Date of birth:', 'Phone number:', 'Email:', 'Home address:', 'Postcode:', 'Reason for visit:', 'Signature:', 'Occupation:', 'Nationality:'];

  it('passes at exactly 90% of labels within 10% CER', () => {
    const lines = labels.slice(0, 9);
    const r = validationBar(labels, lines);
    expect(r.passedCount).toBe(9);
    expect(r.share).toBe(0.9);
    expect(r.passed).toBe(true);
  });

  it('fails at 80%, with no rounding up', () => {
    const r = validationBar(labels, labels.slice(0, 8));
    expect(r.passed).toBe(false);
    // The closest line is still reported, but it is over the bar.
    expect(r.labels[9]!.passed).toBe(false);
    expect(r.labels[9]!.cer).toBeGreaterThan(0.1);
    expect(r.passedCount).toBe(8);
  });

  it('accepts a label read at the start of a longer line, and rejects a line over 10% CER', () => {
    const r = validationBar(['Full name:', 'Date of birth:'], ['Full name: ________', 'Dxte 0f b1rth:']);
    expect(r.labels[0]!.passed).toBe(true);
    expect(r.labels[1]!.cer).toBeGreaterThan(0.1);
    expect(r.labels[1]!.passed).toBe(false);
  });

  it('fails when there are no expected labels or no recognised text', () => {
    expect(validationBar([], ['x']).passed).toBe(false);
    expect(validationBar(labels, []).passed).toBe(false);
  });
});
