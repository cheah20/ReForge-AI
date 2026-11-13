// @vitest-environment jsdom
/**
 * tests/unit/accessforge-agent-machine-submit.test.ts
 *
 * accessforge-skeleton task 14.2: submission safety in the agent-loop reducer.
 * Validates: Requirements 10.2, 10.6, 10.7, 10.8, 10.9, 10.13, 12.1, 12.7
 */

import { describe, it, expect } from 'vitest';
import { agentReducer, canConfirm, reviewRows, stepInfo } from '../../src/lib/accessforge/agent-machine.js';
import { ANSWERS, TODAY, answerAll, clicks, count, send, toFirstQuestion } from './accessforge-machine-helpers.js';

describe('the acceptance path', () => {
  it('writes each answer, reaches review with every field filled and emits exactly one click after one confirm press', () => {
    let r = toFirstQuestion();
    expect(r.state.phase).toBe('asking');
    expect(stepInfo(r.state)).toEqual({ index: 1, total: 8 });
    r = answerAll(r);
    expect(r.state.phase).toBe('review');
    expect(r.frame.clicks).toBe(0);
    expect(reviewRows(r.state).map((row) => row.status)).toEqual(Array(8).fill('filled'));
    expect(Object.fromEntries(r.frame.values)).toEqual({
      'f0:text:nama': 'LIN MEI TEST',
      'f0:text:nokp': '900101101234',
      'f0:text:tlahir': '01/01/1990',
      'f0:radio:jantina': 'P',
      'f0:text:tel': '011-2345 6789',
      'f0:text:poskod': '43000',
      'f0:select:tujuan': 'PERIKSA',
      'f0:checkbox:akuan': true,
    });

    r = send(r, { type: 'CONFIRM_PRESSED' });
    expect(count(r.effects, 'READ_BACK')).toBe(8);
    expect(clicks(r.effects)).toBe(1);
    expect(r.effects.find((e) => e.type === 'EXECUTE' && e.action.kind === 'click')).toMatchObject({ submitArmed: true, consentGiven: true });
    expect(count(r.effects, 'START_SUBMIT_TIMER')).toBe(1);
    expect(r.state.phase).toBe('submitting');

    // A second press, a timeout of an old attempt and any other event never click again.
    r = send(r, { type: 'CONFIRM_PRESSED' });
    r = send(r, { type: 'SUBMIT_TIMEOUT', attempt: 0 });
    expect(r.frame.clicks).toBe(1);
    expect(canConfirm(r.state)).toEqual({ ok: false, reason: 'SUBMITTED' });

    r = send(r, { type: 'FRAME_LOADED', generation: 3, page: 'confirmation', versionSupported: false });
    expect(r.state.phase).toBe('verifyingResult');
    expect(r.state.confirmationReceived).toBe(true);
    expect(count(r.effects, 'CLEAR_SUBMIT_TIMER')).toBe(1);
    const verify = r.effects.find((e) => e.type === 'VERIFY_RESULT');
    expect(verify && verify.type === 'VERIFY_RESULT' && verify.filled.map((f) => f.intended)).toEqual(['LIN MEI TEST', '900101101234', '01/01/1990', 'P', '011-2345 6789', '43000', 'PERIKSA', true]);
    r = send(r, { type: 'RESULT_VERIFIED', generation: 3, differences: [], reference: 'SR-DEMO-20261117-042137', originalText: 'x' });
    expect(r.state.phase).toBe('done');
    expect(r.frame.clicks).toBe(1);
  });

  it('emits no click on reaching review, on Enter in an input (a NEXT_PRESSED) or on a timeout', () => {
    let r = answerAll(toFirstQuestion());
    expect(r.state.phase).toBe('review');
    r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    r = send(r, { type: 'SUBMIT_TIMEOUT', attempt: 1 });
    r = send(r, { type: 'DATE_FORMAT_CHOSEN', format: 'DD/MM/YYYY' });
    expect(r.frame.clicks).toBe(0);
    expect(r.frame.actions.every((a) => a.kind !== 'click')).toBe(true);
  });

  it('keeps the confirm button unavailable while consent is unticked', () => {
    let r = toFirstQuestion();
    for (let i = 0; i < 7; i++) r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[r.state.current!]!, today: TODAY });
    expect(r.state.current).toBe('f0:checkbox:akuan');
    r = send(r, { type: 'NEXT_PRESSED', answer: { kind: 'consent', checked: false } });
    expect(r.state.phase).toBe('asking');
    expect(r.state.fields.find((f) => f.elementId === 'f0:checkbox:akuan')!.error?.messageKey).toBe('accessforge.consent.required');
    expect(r.frame.values.get('f0:checkbox:akuan')).toBeUndefined();
  });

  it('writes unchecked back to the legacy box when consent is withdrawn from the review screen', () => {
    let r = answerAll(toFirstQuestion());
    r = send(r, { type: 'EDIT_PRESSED', elementId: 'f0:checkbox:akuan' });
    r = send(r, { type: 'NEXT_PRESSED', answer: { kind: 'consent', checked: false } });
    expect(r.frame.values.get('f0:checkbox:akuan')).toBe(false);
    expect(r.state.phase).toBe('asking');
    expect(r.state.current).toBe('f0:checkbox:akuan');
    expect(r.state.fields.find((f) => f.elementId === 'f0:checkbox:akuan')!.status).toBe('pending');
  });
});

describe('read-back mismatches', () => {
  it('moves to halted with no further Action when a read-back differs', () => {
    let r = toFirstQuestion();
    r.frame.tamper = (id, v) => (id === 'f0:text:nama' ? 'LIN MEI' : v);
    r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    expect(r.state.phase).toBe('halted');
    expect(r.state.mismatches).toEqual([{ elementId: 'f0:text:nama', intended: 'LIN MEI TEST', read: 'LIN MEI' }]);
    const actions = r.frame.actions.length;
    r = send(r, { type: 'CONFIRM_PRESSED' });
    r = send(r, { type: 'BACK_PRESSED' });
    expect(r.frame.actions.length).toBe(actions);

    // Re-entering the answer writes again and resumes only when the read-back is equal.
    r.frame.tamper = null;
    r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    expect(r.state.phase).toBe('asking');
    expect(r.state.current).toBe('f0:text:nokp');
    expect(r.state.fields[0]!.status).toBe('filled');
  });

  it('re-reads every field after the confirm press and clicks only if all are equal', () => {
    let r = answerAll(toFirstQuestion());
    r.frame.tamper = (id, v) => (id === 'f0:text:tel' ? '0112345 6789' : v);
    r = send(r, { type: 'CONFIRM_PRESSED' });
    expect(clicks(r.effects)).toBe(0);
    expect(r.state.phase).toBe('halted');
    expect(r.state.mismatches).toEqual([{ elementId: 'f0:text:tel', intended: '011-2345 6789', read: '0112345 6789' }]);
    expect(reviewRows(r.state).find((row) => row.field.elementId === 'f0:text:tel')!.status).toBe('mismatch');

    r.frame.tamper = null;
    r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:tel']!, today: TODAY });
    expect(r.state.phase).toBe('review');
    expect(clicks(r.effects)).toBe(0);
    r = send(r, { type: 'CONFIRM_PRESSED' });
    expect(r.frame.clicks).toBe(1);
  });

  it('marks a field filled only after an equal read-back', () => {
    const r = toFirstQuestion();
    const nama = (s: typeof r.state) => s.fields.find((f) => f.elementId === 'f0:text:nama')!.status;
    const a = agentReducer(r.state, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    expect(a.state.phase).toBe('writing');
    expect(nama(a.state)).toBe('pending');
    const b = agentReducer(a.state, { type: 'ACTION_DONE', generation: 1, elementId: 'f0:text:nama' });
    expect(b.state.phase).toBe('verifying');
    expect(b.effects).toEqual([{ type: 'READ_BACK', generation: 1, elementId: 'f0:text:nama' }]);
    expect(nama(b.state)).toBe('pending');
    // A read-back from an older generation is dropped.
    expect(agentReducer(b.state, { type: 'READ_BACK_DONE', generation: 0, elementId: 'f0:text:nama', result: { kind: 'text', value: 'LIN MEI TEST' } }).state).toBe(b.state);
    const c = agentReducer(b.state, { type: 'READ_BACK_DONE', generation: 1, elementId: 'f0:text:nama', result: { kind: 'text', value: 'LIN MEI TEST' } });
    expect(nama(c.state)).toBe('filled');
    expect(c.state.phase).toBe('asking');
  });
});

describe('error page and unknown outcome', () => {
  it('after an error page, reloads, rewrites every field and opens the first named field; a new confirm press is needed', () => {
    let r = answerAll(toFirstQuestion());
    r = send(r, { type: 'CONFIRM_PRESSED' });
    r = send(r, { type: 'FRAME_LOADED', generation: 3, page: 'error', versionSupported: false, failingNames: ['poskod', 'nokp'] });
    expect(r.state.phase).toBe('errorReturned');
    expect(count(r.effects, 'RELOAD_FRAME')).toBe(1);

    r.frame.values.clear();
    const before = r.frame.actions.length;
    r = send(r, { type: 'FRAME_LOADED', generation: 5, page: 'register', versionSupported: true });
    const rewrites = r.frame.actions.slice(before);
    expect(rewrites).toHaveLength(8);
    expect(rewrites.some((a) => a.kind === 'click')).toBe(false);
    expect(r.state.phase).toBe('asking');
    expect(r.state.current).toBe('f0:text:nokp');
    expect(r.frame.values.get('f0:text:poskod')).toBe('43000');

    r = answerAll(r);
    expect(r.state.phase).toBe('review');
    expect(r.frame.clicks).toBe(1);
    r = send(r, { type: 'CONFIRM_PRESSED' });
    expect(r.frame.clicks).toBe(2);
  });

  it('gives unknownOutcome after 15 s, verifies a late confirmation, and needs a new confirm after trying again', () => {
    let r = answerAll(toFirstQuestion());
    r = send(r, { type: 'CONFIRM_PRESSED' });
    r = send(r, { type: 'SUBMIT_TIMEOUT', attempt: r.state.submitAttempt });
    expect(r.state.phase).toBe('unknownOutcome');
    expect(r.frame.clicks).toBe(1);

    const late = send(r, { type: 'FRAME_LOADED', generation: 4, page: 'confirmation', versionSupported: false });
    expect(late.state.phase).toBe('verifyingResult');

    r = send(r, { type: 'TRY_AGAIN_PRESSED' });
    expect(count(r.effects, 'RELOAD_FRAME')).toBe(1);
    r = send(r, { type: 'FRAME_LOADED', generation: 5, page: 'register', versionSupported: true });
    expect(r.state.phase).toBe('review');
    expect(r.frame.clicks).toBe(1);
    r = send(r, { type: 'CONFIRM_PRESSED' });
    expect(r.frame.clicks).toBe(2);
  });

  it('reports not verified when the result has differences, and never resubmits', () => {
    let r = answerAll(toFirstQuestion());
    r = send(r, { type: 'CONFIRM_PRESSED' });
    r = send(r, { type: 'FRAME_LOADED', generation: 3, page: 'confirmation', versionSupported: false });
    r = send(r, { type: 'RESULT_VERIFIED', generation: 3, differences: [{ kind: 'missing', name: 'tel' }], reference: null, originalText: null });
    expect(r.state.phase).toBe('notVerified');
    r = send(r, { type: 'CONFIRM_PRESSED' });
    r = send(r, { type: 'FRAME_LOADED', generation: 4, page: 'home', versionSupported: true });
    expect(r.state.phase).toBe('notVerified');
    expect(r.state.pageNotice).toBe(true);
    expect(r.frame.clicks).toBe(1);
  });
});
