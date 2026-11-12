// @vitest-environment jsdom
/**
 * tests/unit/accessforge-extract.test.ts
 *
 * accessforge-skeleton task 8.2, Property 4: entered state never reaches the
 * Page_Model. Documents that differ only in entered values (typed text, value
 * attributes of text inputs, checked radios and checkboxes, selected options,
 * and their default attributes) and in hidden inputs give deep-equal models
 * with identical JSON, and no entered string appears in it.
 * Validates: Requirements 5.2, 5.5, 5.7, 17.5, 17.9
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractPageModel } from '../../src/lib/accessforge/extract.js';
import { TEMPLATES, PAGE_VERSIONS } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import type { PageModel } from '../../src/shared/page-schemas.js';

const VERSION = PAGE_VERSIONS.register;
const registerDoc = () => new DOMParser().parseFromString(fill(TEMPLATES.register, {}), 'text/html');

function extract(doc: Document): PageModel {
  const r = extractPageModel(doc, VERSION);
  if (!r.ok) throw new Error(`refused: ${r.code}`);
  return r.model;
}

const CANARY = 'CANARY_ENTERED_7Q2';
const TEXT_NAMES = ['nama', 'nokp', 'tlahir', 'tel', 'poskod'] as const;

/** Worker and DOM typings clash on HTMLSelectElement; this is the part the test uses. */
type SelectLike = { options: ArrayLike<Element>; selectedIndex: number; value: string };
const selectOf = (root: { querySelector(s: string): unknown }) => root.querySelector('select[name="tujuan"]') as unknown as SelectLike;

// Entered strings: always carry the canary, plus any characters, markup and whitespace.
const enteredArb = fc
  .tuple(fc.string({ unit: 'binary', maxLength: 30 }), fc.constantFrom('', ' ', '<b>', '"x"', '\n'))
  .map(([s, extra]) => `${CANARY}${extra}${s}`);

interface EnteredState {
  typed: Array<string | null>;
  valueAttr: Array<string | null>;
  radio: 'none' | 'L' | 'P';
  radioAttr: 'none' | 'L' | 'P';
  checkbox: boolean;
  checkboxAttr: boolean;
  selectIndex: number;
  selectedAttr: number | null;
  hidden: Array<[string, string]>;
}

const stateArb: fc.Arbitrary<EnteredState> = fc.record({
  typed: fc.array(fc.option(enteredArb, { nil: null }), { minLength: 5, maxLength: 5 }),
  valueAttr: fc.array(fc.option(enteredArb, { nil: null }), { minLength: 5, maxLength: 5 }),
  radio: fc.constantFrom('none' as const, 'L' as const, 'P' as const),
  radioAttr: fc.constantFrom('none' as const, 'L' as const, 'P' as const),
  checkbox: fc.boolean(),
  checkboxAttr: fc.boolean(),
  selectIndex: fc.integer({ min: 0, max: 4 }),
  selectedAttr: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
  hidden: fc.array(fc.tuple(enteredArb, enteredArb), { maxLength: 3 }),
});

function enter(doc: Document, s: EnteredState): void {
  const form = doc.querySelector('form')!;
  TEXT_NAMES.forEach((name, i) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    const attr = s.valueAttr[i];
    if (attr != null) input.setAttribute('value', attr);
    const typed = s.typed[i];
    if (typed != null) input.value = typed;
  });
  const radios = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="jantina"]'));
  for (const r of radios) {
    if (s.radioAttr !== 'none' && r.getAttribute('value') === s.radioAttr) r.setAttribute('checked', 'checked');
    if (s.radio !== 'none') r.checked = r.getAttribute('value') === s.radio;
  }
  const box = form.querySelector<HTMLInputElement>('input[name="akuan"]')!;
  if (s.checkboxAttr) box.setAttribute('checked', 'checked');
  box.checked = s.checkbox;
  const select = selectOf(form);
  if (s.selectedAttr !== null) select.options[s.selectedAttr]!.setAttribute('selected', 'selected');
  select.selectedIndex = s.selectIndex;
  for (const [name, value] of s.hidden) {
    const h = doc.createElement('input');
    h.setAttribute('type', 'hidden');
    h.setAttribute('name', name);
    h.setAttribute('value', value);
    form.appendChild(h);
  }
}

describe('Property 4: entered state never reaches the Page_Model', () => {
  const baseline = extract(registerDoc());
  const baselineJson = JSON.stringify(baseline);

  it('the untouched page has ten entries', () => {
    expect(baseline.entries).toHaveLength(10);
  });

  it('the entered state is really in the document before extraction (canary check)', () => {
    const doc = registerDoc();
    enter(doc, {
      typed: [CANARY, null, null, null, null],
      valueAttr: [null, CANARY, null, null, null],
      radio: 'P',
      radioAttr: 'L',
      checkbox: true,
      checkboxAttr: true,
      selectIndex: 3,
      selectedAttr: 2,
      hidden: [[CANARY, CANARY]],
    });
    expect(doc.querySelector<HTMLInputElement>('input[name="nama"]')!.value).toBe(CANARY);
    expect(doc.documentElement.outerHTML).toContain(CANARY);
    expect(selectOf(doc).value).toBe('VAKSIN');
    expect(JSON.stringify(extract(doc))).toBe(baselineJson);
  });

  it('documents differing only in entered values give identical models (property)', () => {
    fc.assert(
      fc.property(stateArb, stateArb, (a, b) => {
        const docA = registerDoc();
        const docB = registerDoc();
        enter(docA, a);
        enter(docB, b);
        const mA = extract(docA);
        const mB = extract(docB);
        expect(mA).toEqual(mB);
        const json = JSON.stringify(mA);
        expect(json).toBe(JSON.stringify(mB));
        expect(json).toBe(baselineJson);
        expect(json).not.toContain(CANARY);
      }),
      { numRuns: 100 },
    );
  });
});
