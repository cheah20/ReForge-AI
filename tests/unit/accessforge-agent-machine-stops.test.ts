// @vitest-environment jsdom
/**
 * tests/unit/accessforge-agent-machine-stops.test.ts
 *
 * accessforge-skeleton task 14.3: stops and refusals in the agent-loop reducer.
 * Validates: Requirements 3.3, 3.6, 3.8, 3.9, 5.10, 6.15, 6.19, 7.10, 7.11, 12.6, 13.8
 */

import { describe, it, expect } from 'vitest';
import { agentReducer, languageLocked, type AgentState } from '../../src/lib/accessforge/agent-machine.js';
import { MODEL, planFor } from './accessforge-helpers.js';
import { ANSWERS, TODAY, answerAll, count, fresh, send, toFirstQuestion } from './accessforge-machine-helpers.js';

const atNotice = () => send(send(fresh(), { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true }), { type: 'REVIVE_PRESSED' });

describe('before analysis', () => {
  it('sends no analysis before the notice is acknowledged', () => {
    let r = atNotice();
    expect(r.state.phase).toBe('notice');
    expect(r.effects).toEqual([]);
    r = send(r, { type: 'MODEL_READY', generation: 1, model: MODEL });
    expect(r.effects).toEqual([]);
    r = send(r, { type: 'NOTICE_DISMISSED' });
    expect(r.state.phase).toBe('idle');
    r = send(send(r, { type: 'REVIVE_PRESSED' }), { type: 'NOTICE_ACKNOWLEDGED' });
    expect(r.effects).toEqual([{ type: 'EXTRACT', generation: 1 }]);
    r = send(r, { type: 'MODEL_READY', generation: 1, model: MODEL });
    expect(r.effects).toEqual([{ type: 'ANALYZE', generation: 1, model: MODEL, interfaceLanguage: 'en' }]);
  });

  it('gives versionUnsupported with no effects for an unrecorded registration version, and offers no revive', () => {
    let r = send(fresh(), { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: false });
    expect(r.state.phase).toBe('versionUnsupported');
    expect(r.effects.filter((e) => e.type !== 'ABORT_PENDING')).toEqual([]);
    r = send(r, { type: 'REVIVE_PRESSED' });
    expect(r.state.phase).toBe('versionUnsupported');
    expect(r.effects).toEqual([]);
  });

  it('gives unreadable with no analysis effect when the submit count is wrong', () => {
    let r = send(atNotice(), { type: 'NOTICE_ACKNOWLEDGED' });
    r = send(r, { type: 'EXTRACT_FAILED', generation: 1, code: 'SUBMIT_COUNT' });
    expect(r.state.phase).toBe('unreadable');
    expect(r.state.errorCode).toBe('SUBMIT_COUNT');
    expect(count(r.effects, 'ANALYZE')).toBe(0);
  });

  it('gives analysisFailed on AI_UNAVAILABLE and a timeout, and retries on request', () => {
    let r = send(send(atNotice(), { type: 'NOTICE_ACKNOWLEDGED' }), { type: 'MODEL_READY', generation: 1, model: MODEL });
    for (const code of ['AI_UNAVAILABLE', 'TIMEOUT']) {
      const failed = send(r, { type: 'ANALYSIS_FAILED', generation: 1, code });
      expect(failed.state.phase).toBe('analysisFailed');
      expect(failed.state.errorCode).toBe(code);
      expect(failed.frame.actions).toEqual([]);
      r = send(failed, { type: 'RETRY_PRESSED' });
      expect(r.effects).toEqual([{ type: 'ANALYZE', generation: 1, model: MODEL, interfaceLanguage: 'en' }]);
    }
  });

  it('drops a stale analysis reply after a reload and aborts the old request', () => {
    let r = send(send(atNotice(), { type: 'NOTICE_ACKNOWLEDGED' }), { type: 'MODEL_READY', generation: 1, model: MODEL });
    r = send(r, { type: 'FRAME_LOADED', generation: 2, page: 'register', versionSupported: true });
    expect(r.effects).toContainEqual({ type: 'ABORT_PENDING', before: 2 });
    expect(r.state.phase).toBe('stopped');
    const late = send(r, { type: 'PLAN_READY', generation: 1, analysisMode: 'mock', plan: planFor() });
    expect(late.state).toEqual(r.state);
    expect(late.effects).toEqual([]);
  });
});

describe('during the question flow', () => {
  it.each([
    ['a reload of the registration page', 'register'],
    ['the home page', 'home'],
    ['a page outside the Allow_List', 'not-allowed'],
  ] as const)('stops on %s, keeps the answers and runs no Action', (_label, page) => {
    let r = send(toFirstQuestion(), { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    const actions = r.frame.actions.length;
    r = send(r, { type: 'FRAME_LOADED', generation: 2, page, versionSupported: true });
    expect(r.state.phase).toBe('stopped');
    expect(r.state.stopReason).toBe('pageNotSupported');
    expect(r.state.keptAnswers['f0:text:nama']).toEqual(ANSWERS['f0:text:nama']);
    r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nokp']!, today: TODAY });
    r = send(r, { type: 'CONFIRM_PRESSED' });
    expect(r.frame.actions.length).toBe(actions);
  });

  it('reloads from the stop, returns to idle and keeps the answers for the next revival', () => {
    let r = send(toFirstQuestion(), { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    r = send(r, { type: 'FRAME_LOADED', generation: 2, page: 'home', versionSupported: true });
    r = send(r, { type: 'RELOAD_PRESSED' });
    expect(count(r.effects, 'RELOAD_FRAME')).toBe(1);
    r = send(r, { type: 'FRAME_LOADED', generation: 4, page: 'register', versionSupported: true });
    expect(r.state.phase).toBe('idle');
    r = send(send(send(r, { type: 'REVIVE_PRESSED' }), { type: 'NOTICE_ACKNOWLEDGED' }), { type: 'MODEL_READY', generation: 4, model: MODEL });
    r = send(r, { type: 'PLAN_READY', generation: 4, analysisMode: 'mock', plan: planFor() });
    expect(r.state.fields[0]!.answer).toEqual(ANSWERS['f0:text:nama']);
    expect(r.state.fields[0]!.status).toBe('pending');
  });

  it('stops with the form-target reason when the Executor reports FORM_TARGET', () => {
    const r = toFirstQuestion();
    const a = agentReducer(r.state, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    const b = agentReducer(a.state, { type: 'ACTION_REJECTED', generation: 1, elementId: 'f0:text:nama', reason: 'FORM_TARGET' });
    expect(b.state.phase).toBe('stopped');
    expect(b.state.stopReason).toBe('formTarget');
  });

  it('makes a field do it yourself when the Executor cannot find it, and moves on', () => {
    const r = toFirstQuestion();
    const a = agentReducer(r.state, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    const b = agentReducer(a.state, { type: 'ACTION_REJECTED', generation: 1, elementId: 'f0:text:nama', reason: 'NOT_FOUND' });
    expect(b.state.fields[0]).toMatchObject({ status: 'do-it-yourself', diyReason: 'NOT_FOUND' });
    expect(b.state.phase).toBe('asking');
    expect(b.state.current).toBe('f0:text:nokp');
  });
});

describe('cancel', () => {
  it('confirmed: discards answers, aborts, reloads and returns to idle with nothing submitted', () => {
    let r = send(toFirstQuestion(), { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    r = send(r, { type: 'CANCEL_PRESSED' });
    expect(r.state.phase).toBe('cancelConfirm');
    r = send(r, { type: 'CANCEL_CONFIRMED' });
    expect(r.effects).toEqual([{ type: 'ABORT_PENDING', before: 2 }, { type: 'CLEAR_SUBMIT_TIMER' }, { type: 'RELOAD_FRAME' }]);
    expect(r.state.fields).toEqual([]);
    expect(r.state.keptAnswers).toEqual({});
    r = send(r, { type: 'FRAME_LOADED', generation: 3, page: 'register', versionSupported: true });
    expect(r.state.phase).toBe('idle');
    expect(r.frame.clicks).toBe(0);
  });

  it('declined: returns to the same step with the answers kept', () => {
    let r = send(toFirstQuestion(), { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    const step = r.state.current;
    r = send(send(r, { type: 'CANCEL_PRESSED' }), { type: 'CANCEL_DECLINED' });
    expect(r.state.phase).toBe('asking');
    expect(r.state.current).toBe(step);
    expect(r.state.fields[0]!.status).toBe('filled');
  });

  it('keeps processing a read-back that arrives while the cancel question is open', () => {
    const r = toFirstQuestion();
    const a = agentReducer(r.state, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    const asked = agentReducer(a.state, { type: 'CANCEL_PRESSED' });
    const b = agentReducer(asked.state, { type: 'ACTION_DONE', generation: 1, elementId: 'f0:text:nama' });
    expect(b.state.phase).toBe('cancelConfirm');
    expect(b.effects).toEqual([{ type: 'READ_BACK', generation: 1, elementId: 'f0:text:nama' }]);
    const c = agentReducer(b.state, { type: 'CANCEL_DECLINED' });
    expect(c.state.phase).toBe('verifying');
  });
});

describe('language picker', () => {
  it('is locked while the loop is active and free before and after', () => {
    const states: Array<[string, AgentState, boolean]> = [];
    let r = fresh();
    states.push(['idle', r.state, false]);
    r = atNotice();
    states.push(['notice', r.state, false]);
    r = toFirstQuestion();
    states.push(['asking', r.state, true]);
    r = answerAll(r);
    states.push(['review', r.state, true]);
    r = send(r, { type: 'CONFIRM_PRESSED' });
    states.push(['submitting', r.state, true]);
    r = send(send(r, { type: 'FRAME_LOADED', generation: 3, page: 'confirmation', versionSupported: false }), { type: 'RESULT_VERIFIED', generation: 3, differences: [], reference: 'SR-DEMO-20261117-042137', originalText: '' });
    states.push(['done', r.state, false]);
    for (const [label, s, locked] of states) expect([label, languageLocked(s)]).toEqual([label, locked]);
  });
});
