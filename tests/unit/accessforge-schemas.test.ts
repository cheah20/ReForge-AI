/**
 * tests/unit/accessforge-schemas.test.ts
 *
 * accessforge-skeleton task 2.2: the page schemas.
 * Validates: Requirements 6.6, 6.17, 8.2
 */

import { describe, it, expect } from 'vitest';
import {
  ActionSchema,
  PageAnalyzeRequestSchema,
  PageAnalyzeResponseSchema,
  PageEntrySchema,
  PageModelSchema,
  PagePlanEntrySchema,
  PagePlanReplySchema,
  PrecomputedPagePlanSchema,
} from '../../src/shared/page-schemas.js';

const VERSION = 'a'.repeat(64);

const entry = (over: Record<string, unknown> = {}) => ({
  elementId: 'text:nama',
  control: 'text',
  name: 'nama',
  id: 'nama',
  labelText: 'Nama penuh',
  neighbourText: '',
  nearbyText: '',
  nextRowText: '',
  options: [],
  hasEmptyOption: false,
  required: true,
  maxLength: 60,
  position: 0,
  duplicateId: false,
  ...over,
});

const planEntry = (over: Record<string, unknown> = {}) => ({
  elementId: 'text:nama',
  humanLabel: 'Full name',
  question: 'What is your full name?',
  answerType: 'text',
  confidence: 0.9,
  ...over,
});

describe('strict objects reject extra keys', () => {
  it.each([
    ['PageEntrySchema', () => PageEntrySchema.safeParse({ ...entry(), value: 'typed text' })],
    ['PageModelSchema', () => PageModelSchema.safeParse({ path: '/legacy/register', pageVersion: VERSION, entries: [entry()], answers: [] })],
    ['PagePlanEntrySchema', () => PagePlanEntrySchema.safeParse({ ...planEntry(), selector: '#nama' })],
    ['PageAnalyzeRequestSchema', () => PageAnalyzeRequestSchema.safeParse({ pageModel: { path: '/legacy/register', pageVersion: VERSION, entries: [entry()] }, interfaceLanguage: 'en', extra: 1 })],
    ['PageAnalyzeResponseSchema', () => PageAnalyzeResponseSchema.safeParse({ analysisMode: 'mock', entries: [], debug: true })],
    ['PrecomputedPagePlanSchema', () => PrecomputedPagePlanSchema.safeParse({ pageVersion: VERSION, interfaceLanguage: 'en', entries: [], note: '' })],
  ])('%s', (_name, parse) => {
    expect(parse().success).toBe(false);
  });

  it('the same objects without the extra key are accepted', () => {
    expect(PageEntrySchema.safeParse(entry()).success).toBe(true);
    expect(PageModelSchema.safeParse({ path: '/legacy/register', pageVersion: VERSION, entries: [entry()] }).success).toBe(true);
    expect(PagePlanEntrySchema.safeParse(planEntry()).success).toBe(true);
    expect(PageAnalyzeResponseSchema.safeParse({ analysisMode: 'mock', entries: [planEntry()] }).success).toBe(true);
  });

  it('a page model is only for /legacy/register with a 64-hex version', () => {
    const model = (o: Record<string, unknown>) => PageModelSchema.safeParse({ path: '/legacy/register', pageVersion: VERSION, entries: [entry()], ...o }).success;
    expect(model({ path: '/legacy/' })).toBe(false);
    expect(model({ pageVersion: 'A'.repeat(64) })).toBe(false);
    expect(model({ entries: [] })).toBe(false);
  });
});

describe('plan entry text bounds', () => {
  it.each([
    ['humanLabel', 1, true],
    ['humanLabel', 80, true],
    ['humanLabel', 81, false],
    ['question', 1, true],
    ['question', 200, true],
    ['question', 201, false],
  ] as const)('%s of %i characters: %s', (key, length, ok) => {
    expect(PagePlanEntrySchema.safeParse(planEntry({ [key]: 'x'.repeat(length) })).success).toBe(ok);
  });

  it('rejects empty and blank text', () => {
    for (const blank of ['', '   ', '\n\t']) {
      expect(PagePlanEntrySchema.safeParse(planEntry({ humanLabel: blank })).success, JSON.stringify(blank)).toBe(false);
      expect(PagePlanEntrySchema.safeParse(planEntry({ question: blank })).success, JSON.stringify(blank)).toBe(false);
    }
  });

  it.each([
    [-0.01, false],
    [0, true],
    [1, true],
    [1.01, false],
  ])('confidence %d: %s', (confidence, ok) => {
    expect(PagePlanEntrySchema.safeParse(planEntry({ confidence })).success).toBe(ok);
  });

  it('accepts only the shared answer types', () => {
    expect(PagePlanEntrySchema.safeParse(planEntry({ answerType: 'ic' })).success).toBe(true);
    expect(PagePlanEntrySchema.safeParse(planEntry({ answerType: 'select' })).success).toBe(false);
  });

  it('a question with markup passes: the schema caps length only and makes no claim about content', () => {
    const question = '<a href="https://example.com">x</a> javascript:alert(1) #nama';
    const parsed = PagePlanEntrySchema.safeParse(planEntry({ question }));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.question).toBe(question);
  });
});

describe('reply envelope', () => {
  it('keeps entries unvalidated so one bad entry can be dropped later, and caps the count', () => {
    expect(PagePlanReplySchema.safeParse({ entries: [planEntry(), { junk: true }, 42] }).success).toBe(true);
    expect(PagePlanReplySchema.safeParse({ entries: Array.from({ length: 101 }, () => ({})) }).success).toBe(false);
  });
});

describe('ActionSchema', () => {
  it('accepts the four action kinds', () => {
    expect(ActionSchema.safeParse({ kind: 'fill', elementId: 'text:nama', value: 'x' }).success).toBe(true);
    expect(ActionSchema.safeParse({ kind: 'select', elementId: 'select:tujuan', value: 'PERIKSA' }).success).toBe(true);
    expect(ActionSchema.safeParse({ kind: 'check', elementId: 'checkbox:akuan', checked: true }).success).toBe(true);
    expect(ActionSchema.safeParse({ kind: 'click', elementId: 'radio:jantina:P' }).success).toBe(true);
  });

  it('rejects "Click" (case matters) and "submit"', () => {
    expect(ActionSchema.safeParse({ kind: 'Click', elementId: 'radio:jantina:P' }).success).toBe(false);
    expect(ActionSchema.safeParse({ kind: 'submit', elementId: 'submit:hantar' }).success).toBe(false);
  });

  it('rejects extra keys on an action', () => {
    expect(ActionSchema.safeParse({ kind: 'fill', elementId: 'text:nama', value: 'x', selector: 'form' }).success).toBe(false);
  });
});
