/**
 * tests/unit/detection.test.ts
 *
 * Combining the detected form language and country across batches. Moved
 * unchanged from session-state.test.ts with `combineVotes` (formbridge-any-document task 2.8).
 * Validates: Requirement 5.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { combineVotes } from '../../src/lib/analysis/detection.js';

describe('combineVotes', () => {
  it('returns a single batch unchanged', () => {
    expect(combineVotes([{ value: 'ms', confidence: 0.82 }])).toEqual({ value: 'ms', confidence: 0.82 });
  });

  it('averages agreeing batches', () => {
    expect(combineVotes([{ value: 'ms', confidence: 0.9 }, { value: 'ms', confidence: 0.7 }]).confidence).toBeCloseTo(0.8);
  });

  it('lets a weak dissent lower the confidence without forcing a confirmation', () => {
    const v = combineVotes([
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'ms', confidence: 0.2 },
    ]);
    expect(v.value).toBe('en');
    expect(v.confidence).toBeCloseTo((0.95 * 5) / 6);
    expect(v.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('forces a confirmation when many confident batches outvote one confident dissent (en 0.95 x4 against ms 0.8)', () => {
    const v = combineVotes([
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'ms', confidence: 0.8 },
    ]);
    // The plain average would be 0.76, above the threshold.
    expect(v).toEqual({ value: 'en', confidence: 0.69 });
  });

  it('picks the first value seen on a tie', () => {
    expect(combineVotes([{ value: 'ms', confidence: 0.5 }, { value: 'en', confidence: 0.5 }]).value).toBe('ms');
  });

  it('property: the winner has the largest summed confidence, the result stays in [0, 1], and a confident dissent always forces confirmation', () => {
    // Confidences lean high so the generator reaches "several confident winners plus one confident dissent",
    // where only the dissent rule (not the average) keeps the result below 0.7.
    const confidence = fc.oneof(
      { arbitrary: fc.double({ min: 0, max: 1, noNaN: true }), weight: 1 },
      { arbitrary: fc.double({ min: 0.7, max: 1, noNaN: true }), weight: 3 },
    );
    const vote = fc.record({ value: fc.constantFrom('ms', 'en', 'zh-Hans'), confidence });
    // Random lists reached that case in only about 60% of 300-run trials, so one
    // branch builds it on purpose: 4 or 5 confident votes for one value, one confident dissent.
    const outvotedDissent = fc
      .tuple(
        fc.array(fc.double({ min: 0.9, max: 1, noNaN: true }), { minLength: 4, maxLength: 5 }),
        fc.double({ min: 0.7, max: 1, noNaN: true }),
        fc.nat(5),
      )
      .map(([wins, dissent, at]) => {
        const votes = wins.map((c) => ({ value: 'en', confidence: c }));
        votes.splice(at % (votes.length + 1), 0, { value: 'ms', confidence: dissent });
        return votes;
      });
    const votesArb = fc.oneof(fc.array(vote, { minLength: 1, maxLength: 6 }), outvotedDissent);
    let sawDissent = 0;
    let sawDissentAboveAverage = 0;
    let sawAgreementAbove = 0;
    fc.assert(
      fc.property(votesArb, (votes) => {
        const result = combineVotes(votes);
        const sum = (v: string) => votes.filter((x) => x.value === v).reduce((a, x) => a + x.confidence, 0);
        for (const v of votes) expect(sum(result.value)).toBeGreaterThanOrEqual(sum(v.value));
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        const dissent = votes.some((v) => v.value !== result.value && v.confidence >= 0.7);
        if (dissent) {
          sawDissent++;
          if (sum(result.value) / votes.length >= 0.7) sawDissentAboveAverage++;
          expect(result.confidence).toBeLessThan(0.7);
        }
        if (!dissent && votes.every((v) => v.value === result.value)) {
          expect(result.confidence).toBeCloseTo(sum(result.value) / votes.length);
          if (result.confidence >= 0.7) sawAgreementAbove++;
        }
      }),
      { numRuns: 300 },
    );
    // The generator reached both outcomes, so the property is not passing on one side only.
    expect(sawDissent).toBeGreaterThan(0);
    expect(sawDissentAboveAverage).toBeGreaterThan(0);
    expect(sawAgreementAbove).toBeGreaterThan(0);
  });
});
