// @vitest-environment jsdom
/**
 * tests/unit/accessforge-heuristic.test.ts
 *
 * accessforge-skeleton task 24.2 (Slice 2) and Property 18 (task 27.13, 100
 * runs): the heuristic plan is deterministic and rule-bound.
 * Validates: Requirements 7.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { heuristicPlan, heuristicTextType } from '../../src/lib/accessforge/heuristic.js';
import { validatePlan } from '../../src/lib/accessforge/plan-validator.js';
import { PagePlanEntrySchema, type PageEntry, type PageModel } from '../../src/shared/page-schemas.js';
import { MODEL } from './accessforge-helpers.js';

const entry = (over: Partial<PageEntry> = {}): PageEntry => ({
  elementId: 'f0:text:x',
  control: 'text',
  name: 'x',
  id: '',
  labelText: '',
  neighbourText: '',
  nearbyText: '',
  nextRowText: '',
  options: [],
  hasEmptyOption: false,
  required: true,
  maxLength: null,
  position: 0,
  duplicateId: false,
  ...over,
});
const modelOf = (...entries: PageEntry[]): PageModel => ({ path: '/legacy/register', pageVersion: 'a'.repeat(64), entries });

describe('the rules table (design Question 3)', () => {
  it.each([
    ['nokp', null, 'ic'],
    ['NoKP', null, 'ic'],
    ['mykad', null, 'ic'],
    ['icnumber', 12, 'ic'],
    ['icnumber', 10, 'text'],
    ['tel', null, 'phone'],
    ['Telefon', null, 'phone'],
    ['mobile', null, 'phone'],
    ['poskod', null, 'postcode'],
    ['zip', null, 'postcode'],
    ['kodpos', 5, 'postcode'],
    ['kodpos', 6, 'text'],
    ['tlahir', null, 'date'],
    ['tarikh_lahir', null, 'date'],
    ['dob', null, 'date'],
    ['birthdate', null, 'date'],
    ['emel', null, 'email'],
    ['email_address', null, 'email'],
    ['nama', null, 'text'],
  ])('text %s (maxlength %s) is %s', (name, max, type) => {
    expect(heuristicTextType(name, max)).toBe(type);
  });

  it('gives select, radio and checkbox the type the control implies, whatever the name', () => {
    const plan = heuristicPlan(
      modelOf(
        entry({ elementId: 'f0:select:tel', control: 'select', name: 'tel' }),
        entry({ elementId: 'f0:radio:nokp', control: 'radio', name: 'nokp' }),
        entry({ elementId: 'f0:checkbox:dob', control: 'checkbox', name: 'dob' }),
      ),
      'en',
    );
    expect(plan.map((p) => p.answerType)).toEqual(['dropdown', 'radio', 'checkbox']);
  });

  it('skips buttons, unsupported controls and repeated ids', () => {
    const plan = heuristicPlan(
      modelOf(
        entry({ elementId: 'f0:text:a', name: 'a' }),
        entry({ elementId: 'f0:submit:s', control: 'submit', name: 's' }),
        entry({ elementId: 'f0:reset:r', control: 'reset', name: 'r' }),
        entry({ elementId: 'f0:unsupported:u', control: 'unsupported', name: 'u' }),
        entry({ elementId: 'f0:text:d', name: 'd', duplicateId: true }),
      ),
      'en',
    );
    expect(plan.map((p) => p.elementId)).toEqual(['f0:text:a']);
  });
});

describe('labels and questions', () => {
  it('uses the legacy label, else the neighbouring-cell text, else the name', () => {
    const plan = heuristicPlan(
      modelOf(
        entry({ elementId: 'f0:text:a', name: 'a', labelText: 'Nama*', neighbourText: 'ignored' }),
        entry({ elementId: 'f0:text:b', name: 'b', neighbourText: 'Alamat' }),
        entry({ elementId: 'f0:text:c', name: 'c' }),
      ),
      'en',
    );
    expect(plan.map((p) => p.humanLabel)).toEqual(['Nama*', 'Alamat', 'c']);
  });

  it('quotes the legacy text in the locale sentence of the language', () => {
    const [p] = heuristicPlan(modelOf(entry({ labelText: 'Nama*', name: 'nama' })), 'en');
    expect(p!.question).toContain('“Nama*”');
    const [zh] = heuristicPlan(modelOf(entry({ labelText: 'Nama*', name: 'nama' })), 'zh-Hans');
    expect(zh!.question).toContain('Nama*');
    expect(zh!.question).not.toEqual(p!.question);
  });

  it('cuts long legacy text to the schema bounds', () => {
    const [p] = heuristicPlan(modelOf(entry({ labelText: 'x'.repeat(200), name: 'nama' })), 'en');
    expect([...p!.humanLabel].length).toBeLessThanOrEqual(80);
    expect([...p!.question].length).toBeLessThanOrEqual(200);
  });

  it('every confidence is 0, so every question is accepted or declined first', () => {
    for (const p of heuristicPlan(MODEL, 'en')) expect(p.confidence).toBe(0);
  });

  it('the plan for the registration page passes the Plan_Validator with every field mapped', () => {
    const plan = validatePlan(MODEL, heuristicPlan(MODEL, 'en'));
    expect(plan.doItYourself.size).toBe(0);
    expect(plan.mapped.size).toBe(8);
    expect(plan.mapped.get('f0:text:nokp')?.answerType).toBe('ic');
    expect(plan.mapped.get('f0:text:tel')?.answerType).toBe('phone');
    expect(plan.mapped.get('f0:text:poskod')?.answerType).toBe('postcode');
    expect(plan.mapped.get('f0:text:tlahir')?.answerType).toBe('date');
  });
});

describe('Property 18: the heuristic plan is deterministic and rule-bound (100 runs)', () => {
  const CONTROLS = ['text', 'select', 'radio', 'checkbox', 'submit', 'reset', 'unsupported'] as const;
  const entryArb = fc.record({
    control: fc.constantFrom(...CONTROLS),
    name: fc.string({ maxLength: 20 }),
    labelText: fc.string({ maxLength: 120 }),
    neighbourText: fc.string({ maxLength: 120 }),
    maxLength: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }),
    duplicateId: fc.boolean(),
  });
  const LANGS = ['en', 'ms', 'zh-Hans', 'zh-Hant', 'ta', 'es', 'id'];

  it('is the same on every call, has only confidence 0, and types text inputs only by the table', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 12 }), fc.constantFrom(...LANGS), (rows, lang) => {
        const model = modelOf(...rows.map((r, i) => entry({ ...r, elementId: `f0:${r.control}:n${i}`, position: i })));
        const a = heuristicPlan(model, lang);
        expect(heuristicPlan(model, lang)).toEqual(a);
        for (const p of a) {
          expect(PagePlanEntrySchema.safeParse(p).success).toBe(true);
          expect(p.confidence).toBe(0);
          const src = model.entries.find((e) => e.elementId === p.elementId)!;
          expect(src.duplicateId).toBe(false);
          if (src.control === 'select') expect(p.answerType).toBe('dropdown');
          else if (src.control === 'radio') expect(p.answerType).toBe('radio');
          else if (src.control === 'checkbox') expect(p.answerType).toBe('checkbox');
          else expect(p.answerType).toBe(heuristicTextType(src.name, src.maxLength));
        }
      }),
      { numRuns: 100 },
    );
  });
});
