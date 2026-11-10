/**
 * tests/unit/fill-properties.test.ts
 *
 * Task 21: property-based tests for PDF filling on fixtures/clinic-registration.pdf.
 * - Property 5: fill then read back returns every written value (Validates: Requirements 10.1, 10.2, 15.1)
 * - Property 6: fields not in the answer set keep their value and appearance (Validates: Requirements 10.3, 15.1)
 * - Property 10: a choice answer is accepted iff it is one of the PDF's export values,
 *   and the export value is what is stored (Validates: Requirement 7.8)
 * - Property 11: a text answer is rejected iff it is longer than MaxLen (Validates: Requirements 7.9, 10.2)
 *
 * Each run loads and saves a real PDF, so run counts are kept small.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { fillPdf, type FieldAnswer } from '../../src/lib/pdf-fill/index.js';
import { fixtureBytes, LATIN_MAP, load, snapshot } from '../helpers/fill-helpers.js';

const CLINIC = fixtureBytes('clinic-registration.pdf');

/** Writable clinic fields, from the fixture specification. */
const TEXT_FIELDS: Record<string, number> = {
  'patient.fullName': 70,
  Text1: 12,
  'patient.birthDate': 10,
  Text7: 8,
  'contact.mobile': 13,
  'contact.homePhone': 12,
  Text3: 80,
  'contact.address': 160,
  'contact.postcode': 5,
  'contact.city': 40,
  'visit.date': 10,
  'medical.description': 180,
  'emergency.name': 70,
  'emergency.phone': 13,
  'visit.shortCode': 4,
};
const CHOICES: Record<string, string[]> = {
  'patient.gender': ['F', 'M', 'X'],
  'contact.state': ['SGR', 'KUL', 'JHR', 'OTH'],
};
const CHECKBOXES = ['visit.firstVisit', 'medical.allergyFlag', 'consent.contact'];
const NEVER_WRITTEN = ['clinic.branchCode', 'consent.signature'];
const ALL_FIELDS = [...Object.keys(TEXT_FIELDS), ...Object.keys(CHOICES), ...CHECKBOXES, ...NEVER_WRITTEN];

/** Short printable text that fits every field: at most min(MaxLen, 12) characters, never blank. */
const textFor = (max: number) =>
  fc
    .string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -/.@'.split('')), minLength: 1, maxLength: Math.min(max, 12) })
    .filter((s) => s.trim() !== '');

/** A non-empty, non-trivial subset of the writable fields with a valid answer for each. */
const answerSet: fc.Arbitrary<Map<string, FieldAnswer>> = fc
  .record(
    {
      ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([id, max]) => [id, textFor(max).map((value): FieldAnswer => ({ kind: 'text', value }))])),
      ...Object.fromEntries(Object.entries(CHOICES).map(([id, opts]) => [id, fc.constantFrom(...opts).map((exportValue): FieldAnswer => ({ kind: 'choice', exportValue }))])),
      ...Object.fromEntries(CHECKBOXES.map((id) => [id, fc.constantFrom('checked', 'unchecked', 'skipped').map((state): FieldAnswer => ({ kind: 'checkbox', state }))])),
    },
    { requiredKeys: [] },
  )
  .map((r) => new Map(Object.entries(r) as [string, FieldAnswer][]))
  .filter((m) => m.size >= 2);

let baseline: Awaited<ReturnType<typeof load>>;
beforeAll(async () => {
  baseline = await load(CLINIC);
});

describe('Property 5: fill / read-back round trip', () => {
  it('every written value reads back exactly', async () => {
    await fc.assert(
      fc.asyncProperty(answerSet, async (answers) => {
        const form = (await load(await fillPdf(CLINIC, answers, LATIN_MAP))).getForm();
        for (const [id, a] of answers) {
          if (a.kind === 'text') expect(form.getTextField(id).getText(), id).toBe(a.value);
          if (a.kind === 'choice') {
            const got = id === 'patient.gender' ? form.getRadioGroup(id).getSelected() : form.getDropdown(id).getSelected()[0];
            expect(got, id).toBe(a.exportValue);
          }
          if (a.kind === 'checkbox' && a.state !== 'skipped') expect(form.getCheckBox(id).isChecked(), id).toBe(a.state === 'checked');
        }
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});

describe('Property 6: untouched fields are unchanged', () => {
  it('every field outside the answer set (and every skipped checkbox) keeps its value and appearance', async () => {
    await fc.assert(
      fc.asyncProperty(answerSet, async (answers) => {
        const out = await load(await fillPdf(CLINIC, answers, LATIN_MAP));
        const untouched = ALL_FIELDS.filter((id) => {
          const a = answers.get(id);
          return !a || (a.kind === 'checkbox' && a.state === 'skipped');
        });
        expect(untouched.length).toBeGreaterThan(0);
        for (const id of untouched) expect(snapshot(out, id), id).toBe(snapshot(baseline, id));
      }),
      { numRuns: 25 },
    );
  }, 120_000);

  it('the property can fail: a changed field does change its snapshot', async () => {
    const out = await load(await fillPdf(CLINIC, new Map([['contact.city', { kind: 'text', value: 'Bandar Rekaan' }]]), LATIN_MAP));
    expect(snapshot(out, 'contact.city')).not.toBe(snapshot(baseline, 'contact.city'));
  });
});

describe('Property 10: choice answers are limited to the PDF export values', () => {
  // Mix real exports, their display labels, and arbitrary strings.
  const candidate = fc.oneof(
    fc.constantFrom('F', 'M', 'X', 'SGR', 'KUL', 'JHR', 'OTH'),
    fc.constantFrom('Perempuan', 'Lelaki', 'Selangor', 'Johor', 'sgr', ''),
    fc.string({ maxLength: 6 }),
  );

  it('accepted iff the answer is an export value; the export value is stored', async () => {
    let rejectedSeen = 0;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...Object.keys(CHOICES)), candidate, async (id, value) => {
        const valid = CHOICES[id]!.includes(value);
        const result = await fillPdf(CLINIC, new Map([[id, { kind: 'choice', exportValue: value }]]), LATIN_MAP).then(
          (bytes) => ({ bytes }),
          (error: unknown) => ({ error }),
        );
        if (!valid) {
          rejectedSeen++;
          expect(result).toHaveProperty('error');
          expect((result as { error: { code: string } }).error.code).toBe('INVALID_CHOICE');
          return;
        }
        expect(result).toHaveProperty('bytes');
        const form = (await load((result as { bytes: Uint8Array }).bytes)).getForm();
        const stored = id === 'patient.gender' ? form.getRadioGroup(id).getSelected() : form.getDropdown(id).getSelected()[0];
        expect(stored).toBe(value);
      }),
      { numRuns: 40 },
    );
    expect(rejectedSeen).toBeGreaterThan(0);
  }, 120_000);
});

describe('Property 11: max length rejection', () => {
  it('rejected iff the answer is longer than MaxLen; never truncated', async () => {
    const shortFields = Object.entries(TEXT_FIELDS).filter(([, max]) => max <= 13);
    let over = 0;
    let within = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...shortFields),
        fc.integer({ min: -3, max: 3 }),
        async ([id, max], delta) => {
          const length = Math.max(1, max + delta);
          const value = 'A'.repeat(length);
          const result = await fillPdf(CLINIC, new Map([[id, { kind: 'text', value }]]), LATIN_MAP).then(
            (bytes) => ({ bytes }),
            (error: unknown) => ({ error }),
          );
          if (length > max) {
            over++;
            expect((result as { error: { code: string } }).error?.code, `${id} ${length}/${max}`).toBe('MAX_LENGTH');
          } else {
            within++;
            expect(result, `${id} ${length}/${max}`).toHaveProperty('bytes');
            const form = (await load((result as { bytes: Uint8Array }).bytes)).getForm();
            expect(form.getTextField(id).getText()).toBe(value);
          }
        },
      ),
      { numRuns: 40 },
    );
    // Both sides of the boundary were generated.
    expect(over).toBeGreaterThan(0);
    expect(within).toBeGreaterThan(0);
  }, 120_000);
});
