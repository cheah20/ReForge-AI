// @vitest-environment jsdom
/**
 * tests/unit/accessforge-plan-validator.test.ts
 *
 * accessforge-skeleton task 9.2, Property 1: plan validation keeps only
 * trustworthy entries and covers every field. The generator mixes every case
 * of Requirement 17.2 (unknown ids, one-character and letter-case near
 * misses, radio option and button ids, duplicates, incompatible types, option
 * lists, extra properties carrying a selector, XPath, script, URL or Action,
 * out-of-range labels and confidences, non-object junk, empty plans) with
 * fully valid plans, which must map every field.
 * Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.12, 6.13, 17.1, 17.2, 17.9
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractPageModel } from '../../src/lib/accessforge/extract.js';
import { validatePlan, validatePlanReply } from '../../src/lib/accessforge/plan-validator.js';
import { TEMPLATES, PAGE_VERSIONS } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import { AnswerTypeSchema } from '../../src/shared/schemas.js';
import type { ControlType, PageModel, PagePlanEntry } from '../../src/shared/page-schemas.js';
import type { AnswerType } from '../../src/shared/types.js';

const r = extractPageModel(new DOMParser().parseFromString(fill(TEMPLATES.register, {}), 'text/html'), PAGE_VERSIONS.register);
if (!r.ok) throw new Error('registration page did not extract');
const MODEL: PageModel = r.model;

const ANSWER_TYPES = AnswerTypeSchema.options as readonly AnswerType[];
const FIELD_IDS = MODEL.entries.filter((e) => e.control !== 'submit' && e.control !== 'reset').map((e) => e.elementId);
const BUTTON_IDS = MODEL.entries.filter((e) => e.control === 'submit' || e.control === 'reset').map((e) => e.elementId);
const OPTION_IDS = MODEL.entries.flatMap((e) => e.options.flatMap((o) => (o.elementId ? [o.elementId] : [])));
const CONTROL = new Map(MODEL.entries.map((e) => [e.elementId, e.control]));
const COMPATIBLE: Record<string, readonly AnswerType[]> = {
  text: ['text', 'ic', 'phone', 'postcode', 'date', 'email', 'description'],
  select: ['dropdown'],
  radio: ['radio'],
  checkbox: ['checkbox'],
};
const IMPLIED: Record<string, AnswerType> = { text: 'text', select: 'dropdown', radio: 'radio', checkbox: 'checkbox' };
const KEYS = ['answerType', 'confidence', 'elementId', 'humanLabel', 'question'];

const fieldIdArb = fc.constantFrom(...FIELD_IDS);
const labelArb = fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0);
const questionArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

const compatibleFor = (id: string) => COMPATIBLE[CONTROL.get(id)!]!;

const entryFor = (elementId: string) =>
  fc.record({
    elementId: fc.constant(elementId),
    humanLabel: labelArb,
    question: questionArb,
    answerType: fc.constantFrom(...compatibleFor(elementId)),
    confidence: confidenceArb,
  });

const validEntryArb = fieldIdArb.chain(entryFor);

const incompatibleEntryArb = validEntryArb.chain((e) =>
  fc.constantFrom(...ANSWER_TYPES.filter((t) => !compatibleFor(e.elementId).includes(t))).map((answerType) => ({ ...e, answerType })),
);

const nearMiss = (id: string, i: number, kind: 'char' | 'case') => {
  const at = i % id.length;
  if (kind === 'case') {
    const flipped = id.replace(/[a-z]/, (c) => c.toUpperCase());
    return flipped === id ? id.toUpperCase() + 'x' : flipped;
  }
  const c = id[at] === 'x' ? 'y' : 'x';
  return id.slice(0, at) + c + id.slice(at + 1);
};

const badTargetArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }),
  fc.constantFrom(...OPTION_IDS),
  fc.constantFrom(...BUTTON_IDS),
  fc.tuple(fieldIdArb, fc.nat(), fc.constantFrom('char' as const, 'case' as const)).map(([id, i, k]) => nearMiss(id, i, k)),
  fieldIdArb.map((id) => ` ${id}`),
);

const EXTRA: Array<[string, unknown]> = [
  ['selector', '#nama'],
  ['xpath', '//input[@name="nama"]'],
  ['script', '<script>alert(1)</script>'],
  ['url', 'https://evil.example/'],
  ['action', { kind: 'click', elementId: 'f0:submit:' }],
  ['options', [{ value: 'EVIL', text: 'Evil' }]],
];

const invalidShapeArb = fc.oneof(
  validEntryArb.chain((e) => fc.constantFrom(...EXTRA).map(([k, v]) => ({ ...e, [k]: v }))),
  validEntryArb.chain((e) => fc.constantFrom('', '   ', 'x'.repeat(81)).map((humanLabel) => ({ ...e, humanLabel }))),
  validEntryArb.chain((e) => fc.constantFrom('', '\n', 'q'.repeat(201)).map((question) => ({ ...e, question }))),
  validEntryArb.chain((e) => fc.constantFrom(-0.01, 1.01, Number.NaN, '0.9').map((confidence) => ({ ...e, confidence }))),
  validEntryArb.chain((e) => fc.constantFrom('Text', 'select', 'unknown').map((answerType) => ({ ...e, answerType }))),
  validEntryArb.map(({ question: _q, ...rest }) => rest),
  fc.constantFrom<unknown>(null, 42, 'f0:text:nama', [], true),
);

const entryArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: validEntryArb, weight: 4 },
  { arbitrary: incompatibleEntryArb, weight: 2 },
  { arbitrary: validEntryArb.chain((e) => badTargetArb.map((elementId) => ({ ...e, elementId }))), weight: 2 },
  { arbitrary: invalidShapeArb, weight: 2 },
);

/** Mixed plans, with a repeat of an earlier entry inserted so duplicates are frequent. */
const mixedPlanArb = fc
  .tuple(fc.array(entryArb, { maxLength: 20 }), fc.array(fc.tuple(fc.nat(), fc.nat(), labelArb), { maxLength: 4 }))
  .map(([entries, dups]) => {
    const out = [...entries];
    for (const [from, to, label] of dups) {
      if (out.length === 0) break;
      const src = out[from % out.length];
      const copy = src && typeof src === 'object' && !Array.isArray(src) ? { ...(src as object), humanLabel: label } : src;
      out.splice(to % (out.length + 1), 0, copy);
    }
    return out;
  });

/** One compatible entry for every field, in a shuffled order. */
const fullyValidPlanArb = fc
  .tuple(...FIELD_IDS.map(entryFor))
  .chain((entries) => fc.shuffledSubarray(entries, { minLength: entries.length, maxLength: entries.length }));

const planArb = fc.oneof(mixedPlanArb, fullyValidPlanArb, fc.constant([] as unknown[]));

/** Independent oracle for the rules of design Question 3. */
function expected(raw: readonly unknown[]): Map<string, PagePlanEntry> {
  const out = new Map<string, PagePlanEntry>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    if (Object.keys(e).sort().join() !== KEYS.join()) continue;
    const { elementId, humanLabel, question, answerType, confidence } = e;
    if (typeof elementId !== 'string' || !FIELD_IDS.includes(elementId)) continue;
    if (typeof humanLabel !== 'string' || humanLabel.length < 1 || humanLabel.length > 80 || humanLabel.trim() === '') continue;
    if (typeof question !== 'string' || question.length < 1 || question.length > 200 || question.trim() === '') continue;
    if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) continue;
    if (typeof answerType !== 'string' || !(ANSWER_TYPES as readonly string[]).includes(answerType)) continue;
    if (out.has(elementId)) continue;
    const control = CONTROL.get(elementId) as ControlType;
    const ok = COMPATIBLE[control]!.includes(answerType as AnswerType);
    out.set(elementId, {
      elementId,
      humanLabel,
      question,
      answerType: ok ? (answerType as AnswerType) : IMPLIED[control]!,
      confidence: ok ? confidence : 0,
    });
  }
  return out;
}

describe('Property 1: plan validation keeps only trustworthy entries and covers every field', () => {
  it('the registration page has eight fields and two buttons', () => {
    expect(FIELD_IDS).toHaveLength(8);
    expect(BUTTON_IDS).toEqual(['f0:submit:', 'f0:reset:']);
  });

  it('holds for generated plans (property)', () => {
    fc.assert(
      fc.property(planArb, (raw) => {
        const plan = validatePlan(MODEL, raw);
        const want = expected(raw);

        expect([...plan.mapped.entries()]).toEqual([...want.entries()]);
        for (const [id, entry] of plan.mapped) {
          expect(FIELD_IDS).toContain(id);
          expect(entry.elementId).toBe(id);
          expect(Object.keys(entry).sort()).toEqual(KEYS);
          expect(COMPATIBLE[CONTROL.get(id)!]).toContain(entry.answerType);
        }
        // Coverage: every field in exactly one of mapped and Do_It_Yourself, buttons in neither.
        for (const id of FIELD_IDS) expect(plan.mapped.has(id) !== plan.doItYourself.has(id)).toBe(true);
        expect([...plan.doItYourself].every((id) => FIELD_IDS.includes(id))).toBe(true);
        expect(plan.submitId).toBe('f0:submit:');
        expect(plan.resetIds).toEqual(['f0:reset:']);
      }),
      { numRuns: 300 },
    );
  });

  it('maps every field for a fully valid plan (property)', () => {
    fc.assert(
      fc.property(fullyValidPlanArb, (raw) => {
        const plan = validatePlan(MODEL, raw);
        expect([...plan.mapped.keys()].sort()).toEqual([...FIELD_IDS].sort());
        expect(plan.doItYourself.size).toBe(0);
        for (const e of raw) expect(plan.mapped.get(e.elementId)).toEqual(e);
      }),
      { numRuns: 100 },
    );
  });
});

describe('plan validator examples', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    elementId: 'f0:text:nama',
    humanLabel: 'Full name',
    question: 'What is your full name?',
    answerType: 'text',
    confidence: 0.9,
    ...over,
  });

  it('marks every field Do_It_Yourself for an empty plan', () => {
    const plan = validatePlan(MODEL, []);
    expect(plan.mapped.size).toBe(0);
    expect([...plan.doItYourself]).toEqual(FIELD_IDS);
  });

  it('keeps the first valid entry and drops a later one for the same id', () => {
    const plan = validatePlan(MODEL, [entry({ humanLabel: 'First' }), entry({ humanLabel: 'Second' })]);
    expect(plan.mapped.get('f0:text:nama')?.humanLabel).toBe('First');
  });

  it('lets a later valid entry win when the first one for the id is invalid', () => {
    const plan = validatePlan(MODEL, [entry({ humanLabel: '', confidence: 0.1 }), entry({ humanLabel: 'Second' })]);
    expect(plan.mapped.get('f0:text:nama')?.humanLabel).toBe('Second');
  });

  it('replaces an incompatible type with the implied type and confidence 0', () => {
    const plan = validatePlan(MODEL, [entry({ elementId: 'f0:select:tujuan', answerType: 'ic', confidence: 0.95 })]);
    expect(plan.mapped.get('f0:select:tujuan')).toMatchObject({ answerType: 'dropdown', confidence: 0 });
  });

  it('drops entries for radio option ids, buttons and near-miss ids', () => {
    const plan = validatePlan(MODEL, [
      entry({ elementId: 'f0:radio:jantina:L', answerType: 'radio' }),
      entry({ elementId: 'f0:submit:' }),
      entry({ elementId: 'f0:reset:' }),
      entry({ elementId: 'f0:text:Nama' }),
      entry({ elementId: 'f0:text:nam' }),
    ]);
    expect(plan.mapped.size).toBe(0);
  });

  it('drops an entry that carries a selector or an options list', () => {
    expect(validatePlan(MODEL, [entry({ selector: '#nama' })]).mapped.size).toBe(0);
    expect(validatePlan(MODEL, [entry({ elementId: 'f0:select:tujuan', answerType: 'dropdown', options: [{ value: 'X', text: 'X' }] })]).mapped.size).toBe(0);
  });

  it('marks an unsupported control Do_It_Yourself whatever the plan says', () => {
    const model: PageModel = {
      ...MODEL,
      entries: [...MODEL.entries, { ...MODEL.entries[0]!, elementId: 'f0:unsupported:alamat', control: 'unsupported', name: 'alamat', position: 10 }],
    };
    const plan = validatePlan(model, [entry({ elementId: 'f0:unsupported:alamat' })]);
    expect(plan.mapped.has('f0:unsupported:alamat')).toBe(false);
    expect(plan.doItYourself.has('f0:unsupported:alamat')).toBe(true);
  });

  it('returns null for a reply that fails the envelope and validates one that passes', () => {
    expect(validatePlanReply(MODEL, null)).toBeNull();
    expect(validatePlanReply(MODEL, { entries: 'x' })).toBeNull();
    expect(validatePlanReply(MODEL, { entries: Array.from({ length: 101 }, () => entry()) })).toBeNull();
    expect(validatePlanReply(MODEL, { entries: [entry()] })?.mapped.get('f0:text:nama')?.humanLabel).toBe('Full name');
  });
});
