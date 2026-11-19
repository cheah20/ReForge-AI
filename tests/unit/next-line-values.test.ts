/**
 * tests/unit/next-line-values.test.ts
 *
 * The line directly below a question is treated as a prefilled value and never
 * offered (25 runs for the property).
 * Validates: Requirements 11.2, 12.5, 24.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { nextLineValues } from '../../src/lib/document/next-line-values.js';
import { buildCandidates, buildPage } from '../../src/lib/document/model.js';
import { classifyByValueRules } from '../../src/lib/document/value-rules.js';
import { isPromptShaped } from '../../src/lib/document/review-order.js';

/** Lines of 40 px height, 10 px apart unless a gap is given. */
function page(rows: Array<string | [string, number]>) {
  let top = 100;
  const lines = rows.map((r) => {
    const [text, gap] = typeof r === 'string' ? [r, 10] : r;
    top += gap;
    const box = { left: 100, top, right: 600, bottom: top + 40 };
    top += 40;
    return { text, box, confidence: 0.95 };
  });
  return buildPage({ pageNumber: 1, width: 1000, height: 3000, rotation: 0, textSource: 'ocr', lines });
}
const texts = (p: ReturnType<typeof page>, idx: Set<number>) => p.lines.filter((l) => idx.has(l.index)).map((l) => l.text);

describe('nextLineValues', () => {
  it('flags a name directly below a question', () => {
    const p = page(['Full name:', 'ZQXNAME KAPPA', 'Reason for visit:', 'ZQXFREE canary sentence for privacy tests.']);
    expect(texts(p, nextLineValues(p))).toEqual(['ZQXNAME KAPPA', 'ZQXFREE canary sentence for privacy tests.']);
  });

  it('keeps consecutive questions: a prompt below a prompt is not a value', () => {
    const p = page(['Full name:', 'Phone:', 'Address ______', 'Email:']);
    expect(nextLineValues(p).size).toBe(0);
  });

  it('does not flag a line that has its own colon', () => {
    const p = page(['Full name:', 'Nama: Aisha']);
    expect(nextLineValues(p).size).toBe(0);
  });

  it('does not flag a long block (an instruction, not an answer)', () => {
    const p = page(['Declaration:', 'I confirm that all the details given above are true and complete to the best of my knowledge.']);
    expect(nextLineValues(p).size).toBe(0);
  });

  it('does not flag a line far below the question', () => {
    const p = page(['Full name:', ['Section B', 200]]);
    expect(nextLineValues(p).size).toBe(0);
  });

  it('does not flag the first line or a line below a heading', () => {
    const p = page(['Clinic registration', 'Full name:']);
    expect(nextLineValues(p).size).toBe(0);
  });
});

describe('classification uses it', () => {
  it('a next-line value is value-like and so is never a candidate; the question stays', () => {
    const p = page(['Community Clinic', 'Full name:', 'ZQXNAME KAPPA', 'Reason for visit:']);
    const candidates = buildCandidates([p], null, 'eng', classifyByValueRules);
    expect(candidates.map((c) => c.text)).toEqual(['Community Clinic', 'Full name:', 'Reason for visit:']);
  });
});

describe('property: a prompt-shaped line is never hidden by this rule (25 runs)', () => {
  it('flags only lines that are not prompt-shaped and have no colon', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 30 }), { maxLength: 20 }), (texts) => {
        const p = page(texts.filter((t) => t.trim().length > 0));
        for (const i of nextLineValues(p)) {
          const line = p.lines[i]!;
          expect(isPromptShaped(line.text)).toBe(false);
          expect(/[:：]/u.test(line.text)).toBe(false);
        }
      }),
      { numRuns: 25 },
    );
  });
});
