/**
 * tests/unit/document-review.test.ts
 *
 * Tier A label review and request builder (formbridge-any-document tasks 7.1,
 * 7.4, 7.6): nothing is preselected, only a tap selects, edits never select,
 * the request carries only kept labels, and the prefilled fixtures leak no
 * canary into any request.
 * Validates: Requirements 12.3, 12.5, 12.9, 12.12, 12.16, 13.1, 13.11, 24.7
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { initialReview, keptLabels, reduceReview, selectedCount, type ReviewItem } from '../../src/lib/document/review.js';
import { buildLabelAnalysisRequests } from '../../src/lib/document/request.js';
import { buildCandidates, buildPage } from '../../src/lib/document/model.js';
import { classifyByValueRules } from '../../src/lib/document/value-rules.js';
import type { LabelCandidate } from '../../src/lib/document/types.js';

const cand = (page: number, line: number, text: string, labelClass: LabelCandidate['labelClass'] = 'ambiguous'): LabelCandidate => ({
  labelId: `p${page}-l${line}`,
  pageNumber: page,
  lineIndex: line,
  text,
  labelClass,
  textLang: 'en',
  checkYourself: false,
});

describe('label review reducer (7.1)', () => {
  const items = () => initialReview([cand(1, 0, 'Full name:'), cand(1, 1, 'Phone:'), cand(2, 0, 'Signature:')]);
  const toggle = (it: ReviewItem[], id: string) => reduceReview(it, { type: 'toggle', labelId: id });

  it('starts with nothing selected when no candidate is likely-label (Tier A)', () => {
    expect(selectedCount(items())).toBe(0);
    expect(keptLabels(items())).toEqual([]);
  });

  it('would start with exactly the likely-label candidates selected (Tier B classifier)', () => {
    const r = initialReview([cand(1, 0, 'Name:', 'likely-label'), cand(1, 1, 'Other', 'ambiguous')]);
    expect(r.map((i) => i.selected)).toEqual([true, false]);
  });

  it('a tap selects, a second tap clears, and the count follows', () => {
    let r = toggle(items(), 'p1-l1');
    expect(r.map((i) => i.selected)).toEqual([false, true, false]);
    expect(selectedCount(r)).toBe(1);
    r = toggle(r, 'p1-l1');
    expect(selectedCount(r)).toBe(0);
  });

  it('an edit never selects: an unselected item stays unselected after any plain edit', () => {
    const r = reduceReview(items(), { type: 'edit', labelId: 'p1-l0', text: 'Name of the guardian:' });
    expect(r[0]!.text).toBe('Name of the guardian:');
    expect(r[0]!.selected).toBe(false);
  });

  it('a plain edit keeps a selected item selected', () => {
    let r = toggle(items(), 'p1-l0');
    r = reduceReview(r, { type: 'edit', labelId: 'p1-l0', text: 'Surname:' });
    expect(r[0]).toMatchObject({ text: 'Surname:', selected: true, blockedValueLike: false });
  });

  it('a value-like edit clears the selection, blocks the item, and the item cannot be tapped back in', () => {
    let r = toggle(items(), 'p1-l0');
    r = reduceReview(r, { type: 'edit', labelId: 'p1-l0', text: 'Name: Ali bin Abu' });
    expect(r[0]).toMatchObject({ selected: false, blockedValueLike: true });
    expect(toggle(r, 'p1-l0')[0]!.selected).toBe(false);
    // Fixing the text unblocks it, but does not reselect it.
    r = reduceReview(r, { type: 'edit', labelId: 'p1-l0', text: 'Name:' });
    expect(r[0]).toMatchObject({ selected: false, blockedValueLike: false });
    expect(toggle(r, 'p1-l0')[0]!.selected).toBe(true);
  });

  it('empty text clears the selection, keeps the row and cannot be selected', () => {
    let r = toggle(items(), 'p1-l1');
    r = reduceReview(r, { type: 'edit', labelId: 'p1-l1', text: '   ' });
    expect(r).toHaveLength(3);
    expect(r[1]).toMatchObject({ selected: false, blockedValueLike: false });
    expect(toggle(r, 'p1-l1')[1]!.selected).toBe(false);
    expect(keptLabels(r)).toEqual([]);
  });

  it('an edit is cut to 200 code points, the schema limit', () => {
    const r = reduceReview(items(), { type: 'edit', labelId: 'p1-l0', text: 'x'.repeat(250) });
    expect([...r[0]!.text]).toHaveLength(200);
  });

  it('reset restores the original text and the initial selection', () => {
    let r = toggle(items(), 'p1-l0');
    r = reduceReview(r, { type: 'edit', labelId: 'p1-l0', text: 'Changed:' });
    r = reduceReview(r, { type: 'reset' });
    expect(r.map((i) => [i.text, i.selected])).toEqual([['Full name:', false], ['Phone:', false], ['Signature:', false]]);
  });

  it('keptLabels returns selected, valid items in page and reading order with the reading order of the line', () => {
    let r = initialReview([cand(2, 0, 'Signature:'), cand(1, 4, 'Phone:'), cand(1, 1, 'Full name:')]);
    for (const id of ['p2-l0', 'p1-l4', 'p1-l1']) r = toggle(r, id);
    expect(keptLabels(r)).toEqual([
      { labelId: 'p1-l1', text: 'Full name:', pageNumber: 1, readingOrder: 1 },
      { labelId: 'p1-l4', text: 'Phone:', pageNumber: 1, readingOrder: 4 },
      { labelId: 'p2-l0', text: 'Signature:', pageNumber: 2, readingOrder: 0 },
    ]);
  });
});

describe('request builder (7.4)', () => {
  const kept = (n: number) => Array.from({ length: n }, (_, i) => ({ labelId: `p${1 + (i % 5)}-l${i}`, text: `Label ${i}:`, pageNumber: 1 + (i % 5), readingOrder: i }));

  it('builds no request when nothing is kept', () => {
    expect(buildLabelAnalysisRequests([], { interfaceLanguage: 'en' })).toEqual([]);
  });

  it('carries only id, text, page and reading order plus the settings', () => {
    const [r] = buildLabelAnalysisRequests(kept(1), { interfaceLanguage: 'zh-Hans', formLanguage: 'ms', formCountry: 'MY' });
    expect(r).toEqual({
      labels: [{ labelId: 'p1-l0', text: 'Label 0:', pageNumber: 1, readingOrder: 0 }],
      interfaceLanguage: 'zh-Hans',
      formLanguage: 'ms',
      formCountry: 'MY',
    });
    expect(Object.keys(buildLabelAnalysisRequests(kept(1), { interfaceLanguage: 'en' })[0]!)).toEqual(['labels', 'interfaceLanguage']);
  });

  it('splits 61 labels into batches of 30, 30 and 1 in page and reading order', () => {
    const reqs = buildLabelAnalysisRequests([...kept(61)].reverse(), { interfaceLanguage: 'en' });
    expect(reqs.map((r) => r.labels.length)).toEqual([30, 30, 1]);
    const order = reqs.flatMap((r) => r.labels).map((l) => l.pageNumber * 100000 + l.readingOrder);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('prefilled fixture request canary (7.6)', () => {
  interface Mock {
    width: number;
    height: number;
    lines: Array<{ text: string; box: { left: number; top: number; right: number; bottom: number }; confidence: number }>;
  }
  const expected = JSON.parse(readFileSync('fixtures/documents/expected.json', 'utf8')) as { fixtures: Array<{ file: string; pages?: Array<{ mock?: Mock }> }> };
  const reviewOf = (name: string) => {
    const m = expected.fixtures.find((f) => f.file === `${name}.png`)!.pages![0]!.mock!;
    const page = buildPage({ pageNumber: 1, width: m.width, height: m.height, rotation: 0, textSource: 'ocr', lines: m.lines });
    return { printed: m.lines.map((l) => l.text).join('\n'), items: initialReview(buildCandidates([page], null, 'eng', classifyByValueRules)) };
  };
  const requestsFor = (items: ReviewItem[]) => buildLabelAnalysisRequests(keptLabels(items), { interfaceLanguage: 'en' });
  const selectAll = (items: ReviewItem[]) => items.reduce((r, i) => reduceReview(r, { type: 'toggle', labelId: i.labelId }), items);

  it('with the Default_Selection nothing is selected, so no request exists at all', () => {
    for (const name of ['prefilled-sensitive', 'prefilled-split']) {
      const { items } = reviewOf(name);
      expect(items.length).toBeGreaterThan(0);
      expect(requestsFor(items)).toEqual([]);
    }
  });

  it('even with every offered line tapped in, no number, email, split fragment or text after a colon is in any request', () => {
    const cases: Record<string, string[]> = {
      'prefilled-sensitive': ['900101-14-5678', '012-555 0142', 'canary.zqx@example.invalid', 'ZQXCOLON'],
      'prefilled-split': ['880202', '10-5432', '770303', '1234', '0l2', 'S55', 'O199', '\u4e00\u4e8c\u4e09'],
    };
    for (const [name, canaries] of Object.entries(cases)) {
      const { printed, items } = reviewOf(name);
      for (const c of canaries) expect(printed, `${name}: ${c} is printed`).toContain(c);
      const body = JSON.stringify(requestsFor(selectAll(items)));
      expect(body.length).toBeGreaterThan(20);
      for (const c of canaries) expect(body, `${name}: ${c}`).not.toContain(c);
    }
  });

  it('a name or sentence with no number is sent only after the user taps it in (Tier A, until the area detector of task 6.7)', () => {
    const { items } = reviewOf('prefilled-sensitive');
    const name = items.find((i) => i.text === 'ZQXNAME KAPPA')!;
    expect(JSON.stringify(requestsFor(items))).not.toContain('ZQXNAME');
    expect(JSON.stringify(requestsFor(reduceReview(items, { type: 'toggle', labelId: name.labelId })))).toContain('ZQXNAME KAPPA');
  });
});
