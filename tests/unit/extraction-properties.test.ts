/**
 * tests/unit/extraction-properties.test.ts
 *
 * Task 10: property-based tests for extraction and analysis bookkeeping.
 * - Property 1: field completeness, no silent drops (Validates: Requirements 5.5, 6.2, 15.1)
 * - Property 7: page snippet length invariant (Validates: Requirement 4.5)
 * - Property 8: batch count invariant (Validates: Requirement 5.1)
 * - Property 9: low-confidence threshold (Validates: Requirements 5.7, 6.1)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'fs';
import { extractFields } from '../../src/lib/pdf-extract/index.js';
import { computePageSnippets, MAX_SNIPPET_LENGTH, type TextItem } from '../../src/lib/pdf-extract/page-text.js';
import { batchFields } from '../../src/lib/batch.js';
import {
  classifyField,
  isCompatible,
  LOW_CONFIDENCE_THRESHOLD,
  reconcileAnalysis,
} from '../../src/lib/analysis/reconcile.js';
import type { AnswerType, FieldAnalysis, FieldEvidence } from '../../src/shared/types.js';

const ANSWER_TYPES: AnswerType[] = [
  'text', 'ic', 'phone', 'postcode', 'date', 'email', 'checkbox', 'radio', 'dropdown', 'description', 'signature',
];

let clinic: FieldEvidence[];
beforeAll(async () => {
  const r = await extractFields(new Uint8Array(readFileSync('fixtures/clinic-registration.pdf')));
  if (!r.ok) throw new Error(`clinic fixture rejected: ${r.code}`);
  clinic = r.fields;
});

/** An analysis entry for a given fieldId with arbitrary content. */
const analysisFor = (fieldId: fc.Arbitrary<string>) =>
  fc.record({
    fieldId,
    humanLabel: fc.string({ minLength: 1, maxLength: 40 }),
    question: fc.string({ minLength: 1, maxLength: 120 }),
    answerType: fc.constantFrom(...ANSWER_TYPES),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  });

describe('Property 1: field completeness, no silent drops', () => {
  it('every extracted field appears exactly once, with a status, whatever the AI returns', () => {
    const ids = clinic.map((f) => f.fieldId);
    const reply = fc.record({
      // A random subset of the real fields, so some fields are omitted.
      known: fc.subarray(ids).chain((subset) => fc.tuple(...subset.map((id) => analysisFor(fc.constant(id))))),
      // Identities that are not in the PDF.
      unknown: fc.array(analysisFor(fc.string({ minLength: 1, maxLength: 20 }).map((s) => `not.in.pdf.${s}`)), { maxLength: 5 }),
      // Repeats of real identities.
      duplicates: fc.array(analysisFor(fc.constantFrom(...ids)), { maxLength: 5 }),
    });

    // The AI may return entries in any order.
    const shuffledReply = reply.chain((r) => {
      const entries: FieldAnalysis[] = [...r.known, ...r.unknown, ...r.duplicates];
      return fc
        .shuffledSubarray(entries, { minLength: entries.length, maxLength: entries.length })
        .map((all) => ({ ...r, all }));
    });

    fc.assert(
      fc.property(shuffledReply, ({ known, unknown, all }) => {
        const result = reconcileAnalysis(clinic, all);

        // Same fields, same order, each exactly once.
        expect(result.fields.map((f) => f.evidence.fieldId)).toEqual(ids);
        // Unknown identities never become fields.
        expect(unknown.length).toBe(result.discardedUnknown);
        const answered = new Set(all.map((a) => a.fieldId));
        for (const f of result.fields) {
          expect(['mapped', 'low-confidence', 'fill-yourself']).toContain(f.status);
          // Omitted fields are fill-yourself, never dropped and never guessed.
          if (!answered.has(f.evidence.fieldId)) {
            expect(f.status).toBe('fill-yourself');
            expect(f.analysis).toBeNull();
          }
          if (f.analysis) {
            // The first entry for an identity wins over later duplicates
            // (unless it was blank, then the field's own label is used).
            const first = all.find((a) => a.fieldId === f.evidence.fieldId)!;
            if (first.humanLabel.trim() && first.question.trim()) {
              expect(f.analysis.humanLabel).toBe(first.humanLabel);
            }
            // Nothing blank is ever shown as a question.
            expect(f.analysis.humanLabel.trim()).not.toBe('');
            expect(f.analysis.question.trim()).not.toBe('');
            // The answer type is always compatible with the PDF field type.
            expect(isCompatible(f.evidence.fieldType, f.analysis.answerType)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Shrunk counterexample found by Property 1 (fast-check seed 15497109):
  // a duplicate entry with a whitespace-only label and question.
  it('regression: a blank label and question fall back to the field name, never a blank question', () => {
    const r = reconcileAnalysis(clinic, [
      { fieldId: 'patient.fullName', humanLabel: ' ', question: ' ', answerType: 'text', confidence: 0 },
    ]);
    const f = r.fields.find((x) => x.evidence.fieldId === 'patient.fullName')!;
    expect(f.analysis).toMatchObject({
      humanLabel: 'Nama penuh seperti dalam dokumen pengena', // first 40 characters of the tooltip
      confidence: 0,
      answerType: 'text',
    });
    expect(f.analysis!.question).toBe('Nama penuh seperti dalam dokumen pengenalan');
  });

  it('the signature field is fill-yourself even when the AI is confident', () => {
    const sig = clinic.find((f) => f.fieldType === 'signature')!;
    const r = reconcileAnalysis([sig], [
      { fieldId: sig.fieldId, humanLabel: 'Sign', question: 'Sign here', answerType: 'signature', confidence: 1 },
    ]);
    expect(r.fields[0]!.status).toBe('fill-yourself');
  });
});

describe('Property 7: page snippet length invariant', () => {
  const finite = fc.double({ min: -2000, max: 2000, noNaN: true, noDefaultInfinity: true });
  const textItem: fc.Arbitrary<TextItem> = fc.record({
    str: fc.string({ maxLength: 300 }),
    transform: fc.oneof(
      fc.tuple(fc.double({ min: 1, max: 40, noNaN: true }), finite, finite).map(([s, x, y]) => [s, 0, 0, s, x, y]),
      fc.array(fc.double(), { minLength: 0, maxLength: 7 }),
    ),
    width: fc.oneof(fc.double({ min: 0, max: 600, noNaN: true }), fc.double()),
    height: fc.oneof(fc.double({ min: 0, max: 60, noNaN: true }), fc.double()),
  });
  const rect = fc
    .tuple(finite, finite, fc.double({ min: 0, max: 600, noNaN: true }), fc.double({ min: 0, max: 200, noNaN: true }))
    .map(([x, y, w, h]) => ({ left: x, bottom: y, right: x + w, top: y + h }));

  it('every snippet is at most 200 characters, one per widget', () => {
    fc.assert(
      fc.property(fc.array(textItem, { maxLength: 60 }), fc.array(rect, { minLength: 1, maxLength: 10 }), (items, rects) => {
        const snippets = computePageSnippets(items, rects);
        expect(snippets).toHaveLength(rects.length);
        for (const s of snippets) expect(s.length).toBeLessThanOrEqual(MAX_SNIPPET_LENGTH);
      }),
      { numRuns: 300 },
    );
  });
});

describe('Property 8: batch count invariant', () => {
  it('N fields give ceil(N / 30) batches of at most 30, each field exactly once, in order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 150 }), (n) => {
        const fields = Array.from({ length: n }, (_, i) => i);
        const batches = batchFields(fields, 30);
        expect(batches).toHaveLength(Math.ceil(n / 30));
        for (const b of batches) {
          expect(b.length).toBeGreaterThan(0);
          expect(b.length).toBeLessThanOrEqual(30);
        }
        expect(batches.flat()).toEqual(fields);
      }),
    );
  });

  it('rejects a non-positive batch size', () => {
    expect(() => batchFields([1], 0)).toThrow(RangeError);
  });
});

describe('Property 9: low-confidence threshold', () => {
  it('a field with a usable label is low-confidence iff confidence < 0.7', () => {
    const textField = clinic.find((f) => f.fieldId === 'patient.fullName')!;
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (c) => {
        const status = classifyField(textField, {
          fieldId: textField.fieldId,
          humanLabel: 'Full name',
          question: 'What is your full name?',
          answerType: 'text',
          confidence: c,
        });
        expect(status === 'low-confidence').toBe(c < LOW_CONFIDENCE_THRESHOLD);
        expect(status).not.toBe('fill-yourself');
      }),
    );
  });
});
