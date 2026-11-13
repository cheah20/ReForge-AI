/**
 * tests/unit/accessforge-verifier.test.ts
 *
 * accessforge-skeleton task 11.5, Property 3: read-back comparison is exact
 * equality. Pairs that are identical, differ only in surrounding whitespace,
 * letter case or Unicode normalization form, have one side empty, or differ
 * in one character: a Verifier that trims, case-folds or normalizes fails.
 * Validates: Requirements 10.1, 10.3, 17.4, 17.9
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sameValue } from '../../src/lib/accessforge/verifier.js';

type Category = 'identical' | 'whitespace' | 'case' | 'normalization' | 'empty' | 'one-char';

const baseArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.constantFrom('LIN MEI TEST', 'Lin Mei Test', '011-2345 6789', 'caf\u00e9', 'Ni\u00f1o', '\u00c5ngstr\u00f6m', 'x'),
);

const pairArb: fc.Arbitrary<{ category: Category; a: string; b: string }> = fc.oneof(
  baseArb.map((a) => ({ category: 'identical' as const, a, b: a })),
  fc.tuple(baseArb, fc.constantFrom(' ', '\t', '\n', '\u00a0', '  '), fc.boolean()).map(([a, ws, lead]) => ({ category: 'whitespace' as const, a, b: lead ? ws + a : a + ws })),
  baseArb.filter((a) => a.toUpperCase() !== a).map((a) => ({ category: 'case' as const, a, b: a.toUpperCase() })),
  fc.constantFrom('caf\u00e9', 'Ni\u00f1o', '\u00c5ngstr\u00f6m', 'Pe\u0301rez').filter((a) => a.normalize('NFC') !== a.normalize('NFD')).map((a) => ({ category: 'normalization' as const, a: a.normalize('NFC'), b: a.normalize('NFD') })),
  fc.tuple(baseArb, fc.boolean()).map(([a, first]) => ({ category: 'empty' as const, a: first ? '' : a, b: first ? a : '' })),
  fc.tuple(baseArb, fc.nat(), fc.constantFrom('a', '0', ' ', '-')).map(([a, i, c]) => {
    const at = i % a.length;
    const replacement = a[at] === c ? 'z' : c;
    return { category: 'one-char' as const, a, b: a.slice(0, at) + replacement + a.slice(at + 1) };
  }),
);

describe('Property 3: read-back comparison is exact equality', () => {
  it('reports a match exactly when the strings are === (property)', () => {
    const seen = new Set<Category>();
    fc.assert(
      fc.property(pairArb, ({ category, a, b }) => {
        seen.add(category);
        expect(sameValue(a, b)).toBe(a === b);
        if (category === 'identical') expect(sameValue(a, b)).toBe(true);
        else expect(sameValue(a, b)).toBe(false);
      }),
      { numRuns: 300 },
    );
    expect([...seen].sort()).toEqual(['case', 'empty', 'identical', 'normalization', 'one-char', 'whitespace']);
  });
});
