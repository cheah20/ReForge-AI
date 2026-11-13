// @vitest-environment jsdom
/**
 * tests/unit/accessforge-transformations.test.ts
 *
 * accessforge-skeleton task 10.2, Property 7: the Mirror accepts exactly the
 * answers that are present, well-typed and fit. For text answers, the answer
 * is accepted exactly when it is not blank on a required field, the shared
 * `validateAnswer(myPack, ...)` accepts it, and the Intended_Value is at most
 * `maxlength` UTF-16 code units. A rejected answer is left exactly as typed
 * and gives no value; every accepted value on the real form also passes the
 * Legacy_Handler's rules.
 * Validates: Requirements 9.5, 9.6, 9.9, 2.2, 17.8, 17.9
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractPageModel } from '../../src/lib/accessforge/extract.js';
import { legacyLength, toIntendedValue } from '../../src/lib/accessforge/transformations.js';
import { validateAnswer } from '../../src/packs/country/validate.js';
import { myPack } from '../../src/packs/country/my.js';
import { validateSubmission } from '../../src/worker/legacy/submission.js';
import { TEMPLATES, PAGE_VERSIONS } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import type { PageEntry } from '../../src/shared/page-schemas.js';
import type { AnswerType } from '../../src/shared/types.js';
import { VALID } from './legacy-helpers.js';

const r = extractPageModel(new DOMParser().parseFromString(fill(TEMPLATES.register, {}), 'text/html'), PAGE_VERSIONS.register);
if (!r.ok) throw new Error('registration page did not extract');
const entry = (name: string): PageEntry => r.model.entries.find((e) => e.name === name)!;
const TODAY = new Date(Date.UTC(2026, 10, 17));

// Characters: ASCII letters and digits, separators, whitespace, Malay and CJK, and astral (two-unit) characters.
const charArb = fc.oneof(
  fc.constantFrom('a', 'Z', '0', '7', '-', ' ', '+', '\t', '\u00e9', '\u4e00'),
  fc.constantFrom('\u{1F600}', '\u{20000}', '\u{1D11E}'),
);
const wordArb = (maxChars: number) => fc.array(charArb, { maxLength: maxChars }).map((cs) => cs.join(''));
const blankArb = fc.constantFrom('', ' ', '   ', '\t', '\n \t');
const digitsArb = (min: number, max: number) => fc.array(fc.constantFrom(...'0123456789'), { minLength: min, maxLength: max }).map((d) => d.join(''));
const padArb = <T extends string>(a: fc.Arbitrary<T>) => fc.tuple(fc.constantFrom('', ' ', '  '), a, fc.constantFrom('', ' ')).map(([p, v, s]) => p + v + s);

/** A string of exactly n UTF-16 units, mixing one- and two-unit characters. */
const exactUnitsArb = (n: number) =>
  fc.array(fc.boolean(), { minLength: n, maxLength: n }).map((astral) => {
    let s = '';
    for (const a of astral) {
      if (a && s.length + 2 <= n) s += '\u{1F600}';
      else if (s.length < n) s += 'x';
    }
    return s;
  });

const FIELDS: Array<[string, AnswerType, fc.Arbitrary<string>]> = [
  ['nama', 'text', fc.oneof(blankArb, wordArb(70), fc.integer({ min: 55, max: 65 }).chain(exactUnitsArb), padArb(exactUnitsArb(60)))],
  [
    'nokp',
    'ic',
    fc.oneof(
      blankArb,
      wordArb(16),
      digitsArb(10, 14),
      fc.tuple(fc.constantFrom('900101', '901301', '850229', '000229'), fc.constantFrom('', '-', ' '), fc.constantFrom('10', '14', '00'), fc.constantFrom('', '-'), digitsArb(4, 4)).map((p) => padArb(fc.constant(p.join('')))).chain((a) => a),
    ),
  ],
  [
    'tel',
    'phone',
    fc.oneof(
      blankArb,
      wordArb(20),
      fc.tuple(fc.constantFrom('011', '012', '+6012', '6011', '03', '0'), fc.constantFrom('', '-', ' '), digitsArb(6, 9)).map((p) => p.join('')),
    ),
  ],
  ['poskod', 'postcode', fc.oneof(blankArb, wordArb(8), padArb(digitsArb(3, 7)))],
];

/** Synthetic text fields to cover maxlength values on both sides of every length. */
const syntheticArb = fc
  .record({
    maxLength: fc.integer({ min: 0, max: 12 }),
    required: fc.boolean(),
    answerType: fc.constantFrom<AnswerType>('text', 'email', 'description'),
  })
  .chain((f) =>
    fc.record({
      field: fc.constant(f),
      value: fc.oneof(blankArb, wordArb(f.maxLength + 5), fc.integer({ min: 0, max: f.maxLength + 5 }).chain(exactUnitsArb), fc.constant('a@b.example')),
    }),
  );

function oracle(e: PageEntry, type: AnswerType, value: string): { accept: boolean; intended?: string; messageKey?: string } {
  if (value.trim() === '' && e.required) return { accept: false, messageKey: 'validation.required' };
  const v = validateAnswer(myPack, type, value, { required: e.required }, { country: 'MY', today: TODAY });
  if (!v.valid) return { accept: false, messageKey: v.messageKey! };
  const intended = v.normalizedValue!;
  if (e.maxLength !== null && intended.length > e.maxLength) return { accept: false, messageKey: 'validation.maxLength' };
  return { accept: true, intended };
}

function check(e: PageEntry, type: AnswerType, value: string): { accepted: boolean; lengthEdge: number | null } {
  const typed = String(value);
  const answer = { kind: 'text' as const, value };
  const res = toIntendedValue(e, type, answer, { today: TODAY });
  const want = oracle(e, type, value);
  expect(answer.value).toBe(typed);
  if (want.accept) {
    expect(res).toMatchObject({ ok: true, intended: want.intended });
  } else {
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.messageKey).toBe(want.messageKey);
    expect(res).not.toHaveProperty('intended');
    if (!res.ok && res.messageKey === 'validation.maxLength') expect(res.messageParams).toEqual({ max: e.maxLength });
  }
  const v = validateAnswer(myPack, type, value, {}, { country: 'MY', today: TODAY });
  const edge = v.valid && v.normalizedValue !== undefined && e.maxLength !== null ? legacyLength(v.normalizedValue) - e.maxLength : null;
  return { accepted: res.ok, lengthEdge: edge };
}

describe('Property 7: the Mirror accepts exactly the answers that are present, well-typed and fit', () => {
  for (const [name, type, valueArb] of FIELDS) {
    it(`${name} (${type}) on the registration page (property)`, () => {
      const e = entry(name);
      let accepted = 0;
      let rejected = 0;
      fc.assert(
        fc.property(valueArb, (value) => {
          const { accepted: ok } = check(e, type, value);
          if (ok) {
            accepted++;
            const res = toIntendedValue(e, type, { kind: 'text', value }, { today: TODAY });
            const pairs = VALID.map(([n, v]): [string, string] => [n, n === name && res.ok ? String(res.intended) : v]);
            expect(validateSubmission({ entries: pairs.map(([n, v]) => ({ name: n, value: v })) })).toEqual({ ok: true });
          } else rejected++;
        }),
        { numRuns: 200 },
      );
      // Not trivial: both outcomes occurred.
      expect(accepted).toBeGreaterThan(0);
      expect(rejected).toBeGreaterThan(0);
    });
  }

  it('synthetic text fields, lengths 0 to maxlength + 5 (property)', () => {
    const edges = new Set<number>();
    fc.assert(
      fc.property(syntheticArb, ({ field, value }) => {
        const e: PageEntry = { ...entry('nama'), maxLength: field.maxLength, required: field.required };
        const { lengthEdge } = check(e, field.answerType, value);
        if (lengthEdge !== null) edges.add(lengthEdge);
      }),
      { numRuns: 400 },
    );
    // Values exactly at maxlength and one unit over were generated.
    expect(edges.has(0)).toBe(true);
    expect(edges.has(1)).toBe(true);
  });

  it('an astral character counts as two units: 59 x plus one emoji fills a 60-unit field exactly, and one more x does not fit', () => {
    const e = entry('nama');
    expect(toIntendedValue(e, 'text', { kind: 'text', value: 'x'.repeat(58) + '\u{1F600}' })).toMatchObject({ ok: true });
    expect(toIntendedValue(e, 'text', { kind: 'text', value: 'x'.repeat(59) + '\u{1F600}' })).toEqual({
      ok: false,
      messageKey: 'validation.maxLength',
      messageParams: { max: 60 },
    });
  });
});
