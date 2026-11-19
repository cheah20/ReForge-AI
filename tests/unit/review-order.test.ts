/**
 * tests/unit/review-order.test.ts
 *
 * Display grouping of the Label_Review: question-like lines first, nothing
 * selected, nothing lost, order kept (25 runs for the property).
 * Validates: Requirements 12.3, 12.16, 4.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { groupForReview, isPromptShaped } from '../../src/lib/document/review-order.js';
import { initialReview } from '../../src/lib/document/review.js';
import type { LabelCandidate } from '../../src/lib/document/types.js';

const cand = (page: number, line: number, text: string): LabelCandidate => ({
  labelId: `p${page}-l${line}`,
  pageNumber: page,
  lineIndex: line,
  text,
  labelClass: 'ambiguous',
  textLang: 'en',
  checkYourself: false,
});

describe('isPromptShaped', () => {
  it.each(['Full name:', 'Nama penuh:', 'Date of birth :', 'Nama：', 'Address ______', 'Telephone ........', 'Alamat………'])('accepts %s', (t) => {
    expect(isPromptShaped(t)).toBe(true);
  });

  it.each([
    'Please complete this form in black ink and return it to the clinic reception desk before 5 pm.',
    'Section B',
    'Terms and conditions',
    ':',
    '12:',
    'IC No 900101-01-1234:',
    'Email a@b.com:',
    '',
  ])('rejects %j', (t) => {
    expect(isPromptShaped(t)).toBe(false);
  });
});

describe('groupForReview', () => {
  const list = [cand(1, 0, 'Clinic registration'), cand(1, 1, 'Full name:'), cand(1, 2, 'Please use capital letters'), cand(2, 0, 'Phone ____'), cand(2, 1, 'Page 2')];

  it('puts question-like lines first and keeps page and reading order inside each group', () => {
    const { prompts, others } = groupForReview(list);
    expect(prompts.map((c) => c.labelId)).toEqual(['p1-l1', 'p2-l0']);
    expect(others.map((c) => c.labelId)).toEqual(['p1-l0', 'p1-l2', 'p2-l1']);
  });

  it('never preselects: grouping leaves every candidate unselected in the Tier A review', () => {
    const { prompts, others } = groupForReview(list);
    expect(initialReview([...prompts, ...others]).every((i) => !i.selected)).toBe(true);
  });

  it('does not change any candidate', () => {
    const { prompts, others } = groupForReview(list);
    for (const c of [...prompts, ...others]) expect(c).toBe(list.find((x) => x.labelId === c.labelId));
  });

  it('property: every candidate lands in exactly one group, in original relative order (25 runs)', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 30 }), (texts) => {
        const input = texts.map((t, i) => cand(1, i, t));
        const { prompts, others } = groupForReview(input);
        expect(prompts.length + others.length).toBe(input.length);
        const inOrder = (xs: LabelCandidate[]) => xs.every((c, i) => i === 0 || xs[i - 1]!.lineIndex < c.lineIndex);
        expect(inOrder(prompts)).toBe(true);
        expect(inOrder(others)).toBe(true);
        expect(new Set([...prompts, ...others].map((c) => c.labelId)).size).toBe(input.length);
        for (const c of prompts) expect(isPromptShaped(c.text)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});
