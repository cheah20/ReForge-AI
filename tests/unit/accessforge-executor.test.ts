// @vitest-environment jsdom
/**
 * tests/unit/accessforge-executor.test.ts
 *
 * accessforge-skeleton task 11.2, Property 2: the Executor accepts exactly the
 * safe actions and changes only their target. Generated Actions (the four
 * kinds, letter-case variants and other kinds, member, radio group, radio
 * option, button and unknown ids, values on both sides of maxlength, option
 * and non-option values, extra properties) run under generated states (submit
 * armed or not, a submission done, consent given or not, fields made do it
 * yourself, an earlier generation, a replaced document, a changed version).
 * Validates: Requirements 3.9, 8.1, 8.2, 8.3, 8.6, 8.7, 8.8, 8.9, 8.13, 8.14, 10.7, 17.3, 17.9
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { execute } from '../../src/lib/accessforge/executor.js';
import { nextGeneration } from '../../src/lib/accessforge/generation.js';
import { MODEL, contextFor, planFor, registerDoc, snapshot } from './accessforge-helpers.js';

const FIELD_IDS = MODEL.entries.filter((e) => e.control !== 'submit' && e.control !== 'reset').map((e) => e.elementId);
const OPTION_IDS = MODEL.entries.flatMap((e) => e.options.flatMap((o) => (o.elementId ? [o.elementId] : [])));
const MEMBER_IDS = [...MODEL.entries.map((e) => e.elementId), ...OPTION_IDS];

const kindArb = fc.oneof(
  { arbitrary: fc.constantFrom('fill', 'select', 'check', 'click'), weight: 6 },
  { arbitrary: fc.constantFrom('Fill', 'SELECT', 'Check', 'Click', 'submit', 'type', 'clear', ''), weight: 1 },
);
const idArb = fc.oneof(
  { arbitrary: fc.constantFrom(...MEMBER_IDS), weight: 6 },
  { arbitrary: fc.constantFrom('f0:text:Nama', 'f0:text:nam', 'f0:radio:jantina:X', 'f0:select:tujuan:PERIKSA', 'f1:text:nama', '#nama', ''), weight: 1 },
);
const valueArb = fc.oneof(
  fc.constantFrom('', 'PERIKSA', 'LAIN', 'Pemeriksaan am', 'P', 'YA'),
  fc.integer({ min: 0, max: 66 }).map((n) => 'x'.repeat(n)),
  fc.string({ maxLength: 20 }),
);
const actionArb = fc
  .record({ kind: kindArb, elementId: idArb, value: valueArb, checked: fc.boolean(), shape: fc.constantFrom('normal', 'normal', 'normal', 'normal', 'extra', 'missing') })
  .map(({ kind, elementId, value, checked, shape }) => {
    const a: Record<string, unknown> = { kind, elementId };
    if (kind.toLowerCase() === 'fill' || kind.toLowerCase() === 'select') a.value = value;
    if (kind.toLowerCase() === 'check') a.checked = checked;
    if (shape === 'extra') a.selector = '#nama';
    if (shape === 'missing') delete a.elementId;
    return a;
  });

/** Actions whose kind fits their target, so the accepting side is well covered. */
const matchedActionArb: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  fc.tuple(fc.constantFrom(...MODEL.entries.filter((e) => e.control === 'text')), fc.integer({ min: 0, max: 62 })).map(([e, n]) => ({ kind: 'fill', elementId: e.elementId, value: 'y'.repeat(n) })),
  fc.constantFrom('', 'PERIKSA', 'SUSULAN', 'VAKSIN', 'LAIN', 'OTHER').map((value) => ({ kind: 'select', elementId: 'f0:select:tujuan', value })),
  fc.tuple(fc.constantFrom(...OPTION_IDS, 'f0:checkbox:akuan'), fc.boolean()).map(([elementId, checked]) => ({ kind: 'check', elementId, checked })),
  fc.constant({ kind: 'click', elementId: 'f0:submit:' }),
);

interface State {
  submitArmed: boolean;
  submissionDone: boolean;
  consentGiven: boolean;
  diy: string[];
  stale: 'none' | 'old-generation' | 'replaced-document';
}

const stateArb: fc.Arbitrary<State> = fc.record({
  submitArmed: fc.boolean(),
  submissionDone: fc.boolean(),
  consentGiven: fc.boolean(),
  diy: fc.subarray(FIELD_IDS, { maxLength: 3 }),
  stale: fc.constantFrom<State['stale']>('none', 'none', 'none', 'none', 'old-generation', 'replaced-document'),
});

const scenarioArb = fc.record({ action: fc.oneof(actionArb, matchedActionArb), state: stateArb, versionChanged: fc.oneof({ arbitrary: fc.constant(false), weight: 9 }, { arbitrary: fc.constant(true), weight: 1 }) });

/** Requirement 17.3, written out independently of the Executor. */
function shouldAccept(a: Record<string, unknown>, s: State, versionChanged: boolean): boolean {
  const kind = a.kind as string;
  if (!['fill', 'select', 'check', 'click'].includes(kind)) return false;
  if ('selector' in a || typeof a.elementId !== 'string') return false;
  if (s.stale !== 'none' || versionChanged) return false;
  const id = a.elementId;
  const entry = MODEL.entries.find((e) => e.elementId === id);
  const group = MODEL.entries.find((e) => e.options.some((o) => o.elementId === id));
  if (!entry && !group) return false;
  const control = entry ? entry.control : 'radio-option';
  const target = entry ?? group!;
  const kindOk = { fill: control === 'text', select: control === 'select', check: control === 'checkbox' || control === 'radio-option', click: control === 'submit' }[kind as 'fill'];
  if (!kindOk) return false;
  if (s.diy.includes(target.elementId)) return false;
  if (kind === 'fill' && (a.value as string).length > target.maxLength!) return false;
  if (kind === 'select' && !(target.options.some((o) => o.value === a.value) || a.value === '')) return false;
  if (kind === 'check' && control === 'checkbox' && a.checked === true && !s.consentGiven) return false;
  if (kind === 'click' && (!s.submitArmed || s.submissionDone)) return false;
  return true;
}

afterEach(() => vi.restoreAllMocks());

describe('Property 2: the Executor accepts exactly the safe actions and changes only their target', () => {
  it('holds for generated Actions and states (property)', () => {
    const submit = vi.spyOn(window.HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    let accepted = 0;
    let rejected = 0;
    fc.assert(
      fc.property(scenarioArb, ({ action, state, versionChanged }) => {
        submit.mockClear();
        const doc = registerDoc();
        if (versionChanged) doc.querySelector('meta[name="portal-page-version"]')!.setAttribute('content', 'f'.repeat(64));
        let ctx = contextFor(doc, {
          plan: planFor(FIELD_IDS.filter((id) => !state.diy.includes(id))),
          submitArmed: state.submitArmed,
          submissionDone: state.submissionDone,
          consentGiven: state.consentGiven,
        });
        if (state.stale === 'old-generation') ctx = { ...ctx, frame: nextGeneration(ctx.frame, doc) };
        if (state.stale === 'replaced-document') ctx = { ...ctx, liveDocument: registerDoc() };

        const before = snapshot(doc);
        const res = execute(action, ctx);
        const after = snapshot(doc);
        const want = shouldAccept(action, state, versionChanged);
        expect(res.ok).toBe(want);

        const changed = new Set(before.flatMap((b, i) => (b.state !== after[i]!.state ? [b.name] : [])));
        if (!res.ok) {
          rejected++;
          expect(after).toEqual(before);
          expect(submit).not.toHaveBeenCalled();
          return;
        }
        accepted++;
        const targetName = MODEL.entries.find((e) => e.elementId === action.elementId || e.options.some((o) => o.elementId === action.elementId))!.name;
        for (const name of changed) expect(name).toBe(targetName);
        expect(submit).toHaveBeenCalledTimes(action.kind === 'click' ? 1 : 0);
        const el = doc.querySelector(`[name="${targetName}"]`) as unknown as { value: string; checked: boolean } | null;
        if (action.kind === 'fill' || action.kind === 'select') expect(el!.value).toBe(action.value);
        if (action.kind === 'check' && !String(action.elementId).startsWith('f0:radio')) expect(el!.checked).toBe(action.checked);
      }),
      { numRuns: 400 },
    );
    expect(accepted).toBeGreaterThan(20);
    expect(rejected).toBeGreaterThan(20);
  });

  it('accepts the click on the submit button only between the confirm press and a submission', () => {
    const submit = vi.spyOn(window.HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const click = { kind: 'click', elementId: 'f0:submit:' };
    expect(execute(click, contextFor(registerDoc()))).toEqual({ ok: false, reason: 'SUBMIT_NOT_ARMED' });
    expect(execute(click, contextFor(registerDoc(), { submitArmed: true, submissionDone: true }))).toEqual({ ok: false, reason: 'SUBMIT_NOT_ARMED' });
    expect(submit).not.toHaveBeenCalled();
    expect(execute(click, contextFor(registerDoc(), { submitArmed: true }))).toEqual({ ok: true });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('checks a radio option by its option id and rejects a check on the group id', () => {
    const doc = registerDoc();
    expect(execute({ kind: 'check', elementId: 'f0:radio:jantina', checked: true }, contextFor(doc))).toEqual({ ok: false, reason: 'KIND_MISMATCH' });
    expect(execute({ kind: 'check', elementId: 'f0:radio:jantina:P', checked: true }, contextFor(doc))).toEqual({ ok: true });
    const checked = Array.from(doc.querySelectorAll('input[name="jantina"]')).filter((r) => (r as unknown as { checked: boolean }).checked);
    expect(checked.map((r) => r.getAttribute('value'))).toEqual(['P']);
  });
});
