// @vitest-environment jsdom
/**
 * tests/unit/accessforge-submit-count.test.ts
 *
 * accessforge-skeleton tasks 24.1 and 24.3 (Slice 2): a page with no submit
 * button or several is still read; the app writes and checks the answers and
 * leaves the submission to the user. An unrecorded Page_Version shows a notice
 * and the revival goes on.
 * Validates: Requirements 3.5, 6.16
 */
import { describe, it, expect } from 'vitest';
import { validatePlan } from '../../src/lib/accessforge/plan-validator.js';
import { canConfirm } from '../../src/lib/accessforge/agent-machine.js';
import { MODEL, planFor } from './accessforge-helpers.js';
import { answerAll, clicks, count, fresh, send, toFirstQuestion } from './accessforge-machine-helpers.js';

const withoutSubmit = () => ({ ...planFor(), submitId: null });

describe('the Plan_Validator and the submit button count', () => {
  const entry = MODEL.entries.find((e) => e.control === 'submit')!;
  it('gives the submit id when there is exactly one submit button', () => {
    expect(validatePlan(MODEL, []).submitId).toBe(entry.elementId);
  });
  it('gives no submit id for zero submit buttons', () => {
    const model = { ...MODEL, entries: MODEL.entries.filter((e) => e.control !== 'submit') };
    expect(validatePlan(model, []).submitId).toBeNull();
  });
  it('gives no submit id for two submit buttons, and keeps every field mapped or do-it-yourself', () => {
    const second = { ...entry, elementId: 'f0:submit:kedua', position: 99, duplicateId: false };
    const model = { ...MODEL, entries: [...MODEL.entries, second] };
    const plan = validatePlan(model, []);
    expect(plan.submitId).toBeNull();
    expect(plan.doItYourself.size).toBe(MODEL.entries.filter((e) => e.control !== 'submit' && e.control !== 'reset').length);
  });
});

describe('the agent loop without a single submit button', () => {
  it('writes and checks the answers, then hands over without a click or a submit timer', () => {
    let r = answerAll(toFirstQuestion(withoutSubmit()));
    expect(r.state.phase).toBe('review');
    expect(canConfirm(r.state).ok).toBe(true);
    r = send(r, { type: 'CONFIRM_PRESSED' });
    expect(r.state.phase).toBe('handoff');
    expect(clicks(r.effects)).toBe(0);
    expect(count(r.effects, 'START_SUBMIT_TIMER')).toBe(0);
    expect(r.frame.clicks).toBe(0);
    expect(r.state.submissionDone).toBe(false);
    // Every filled field was read again before the hand-over.
    expect(count(r.effects, 'READ_BACK')).toBe(r.state.fields.filter((f) => f.status === 'filled').length);
  });

  it('does not hand over when a field no longer reads as intended', () => {
    let r = answerAll(toFirstQuestion(withoutSubmit()));
    r.frame.tamper = (id, v) => (id === 'f0:text:nama' ? 'CHANGED BY THE PAGE' : v);
    r = send(r, { type: 'CONFIRM_PRESSED' });
    expect(r.state.phase).toBe('halted');
    expect(r.frame.clicks).toBe(0);
  });

  it('stays out of the way after the hand-over: a later page load does not stop anything', () => {
    let r = send(answerAll(toFirstQuestion(withoutSubmit())), { type: 'CONFIRM_PRESSED' });
    r = send(r, { type: 'FRAME_LOADED', generation: 2, page: 'confirmation', versionSupported: false });
    expect(r.state.phase).toBe('handoff');
    expect(r.state.stopReason).toBeNull();
  });

  it('still clicks exactly once when there is a single submit button', () => {
    const r = send(answerAll(toFirstQuestion()), { type: 'CONFIRM_PRESSED' });
    expect(r.state.phase).toBe('submitting');
    expect(r.frame.clicks).toBe(1);
  });
});

describe('an unrecorded Page_Version', () => {
  it('shows the page-changed note and lets the revival go on to the first question', () => {
    let r = send(fresh(), { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: false });
    r = send(send(r, { type: 'REVIVE_PRESSED' }), { type: 'NOTICE_ACKNOWLEDGED' });
    r = send(r, { type: 'MODEL_READY', generation: 1, model: MODEL });
    expect(count(r.effects, 'ANALYZE')).toBe(1);
    r = send(r, { type: 'PLAN_READY', generation: 1, analysisMode: 'mock', plan: planFor() });
    expect(r.state.phase).toBe('asking');
    expect(r.state.pageChanged).toBe(true);
  });
});