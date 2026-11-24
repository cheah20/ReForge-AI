// @vitest-environment jsdom
/**
 * tests/unit/accessforge-low-confidence.test.ts
 *
 * accessforge-skeleton task 26.2 (Slice 2): a question whose confidence is
 * below 0.7 is accepted or declined before its input shows. Declining marks the
 * field do it yourself and writes nothing.
 * Validates: Requirements 6.18
 */

import { describe, it, expect } from 'vitest';
import { agentReducer, fieldById, needsConfidenceCheck } from '../../src/lib/accessforge/agent-machine.js';
import { validatePlan } from '../../src/lib/accessforge/plan-validator.js';
import { MODEL } from './accessforge-helpers.js';
import { ANSWERS, TODAY, fresh, send, type Run } from './accessforge-machine-helpers.js';

const TYPES: Record<string, string> = {
  'f0:text:nama': 'text',
  'f0:text:nokp': 'ic',
  'f0:text:tlahir': 'date',
  'f0:radio:jantina': 'radio',
  'f0:text:tel': 'phone',
  'f0:text:poskod': 'postcode',
  'f0:select:tujuan': 'dropdown',
  'f0:checkbox:akuan': 'checkbox',
};

/** A plan where the listed fields have confidence 0.5 and the rest 0.9. */
function toFirstQuestion(lowIds: string[]): Run {
  const plan = validatePlan(
    MODEL,
    Object.keys(TYPES).map((elementId) => ({ elementId, humanLabel: 'Label', question: 'Question?', answerType: TYPES[elementId], confidence: lowIds.includes(elementId) ? 0.5 : 0.9 })),
  );
  let r = fresh();
  r = send(r, { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true });
  r = send(r, { type: 'REVIVE_PRESSED' });
  r = send(r, { type: 'NOTICE_ACKNOWLEDGED' });
  r = send(r, { type: 'MODEL_READY', generation: 1, model: MODEL });
  r = send(r, { type: 'PLAN_READY', generation: 1, analysisMode: 'mock', plan });
  return r;
}

const answerOpen = (r: Run): Run => send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[r.state.current!]!, today: TODAY });
const open = (r: Run, id: string): Run => {
  for (let i = 0; i < 20 && r.state.current !== id; i++) r = answerOpen(r);
  expect(r.state.current).toBe(id);
  return r;
};
const is = (r: Run, id: string) => fieldById(r.state, id)!;

describe('low-confidence accept or decline (6.18)', () => {
  it('needs a check only below 0.7 and only until accepted', () => {
    let r = toFirstQuestion(['f0:text:nokp']);
    expect(needsConfidenceCheck(is(r, 'f0:text:nama'))).toBe(false);
    r = open(r, 'f0:text:nokp');
    expect(needsConfidenceCheck(is(r, 'f0:text:nokp'))).toBe(true);
    r = send(r, { type: 'LOW_CONFIDENCE_ACCEPTED' });
    expect(needsConfidenceCheck(is(r, 'f0:text:nokp'))).toBe(false);
    expect(r.state.current).toBe('f0:text:nokp');
    expect(r.frame.actions).toHaveLength(1); // only the earlier answer (nama)
  });

  it('ignores an answer before the question is accepted, and writes it after', () => {
    let r = open(toFirstQuestion(['f0:text:nokp']), 'f0:text:nokp');
    const before = r.frame.actions.length;
    r = answerOpen(r);
    expect(r.frame.actions.length).toBe(before);
    expect(r.state.current).toBe('f0:text:nokp');
    r = send(r, { type: 'LOW_CONFIDENCE_ACCEPTED' });
    r = answerOpen(r);
    expect(r.frame.values.get('f0:text:nokp')).toBe('900101101234');
    expect(r.state.current).toBe('f0:text:tlahir');
  });

  it('decline writes nothing, marks the field do it yourself with its reason and opens the next question', () => {
    let r = open(toFirstQuestion(['f0:text:nokp']), 'f0:text:nokp');
    const before = r.frame.actions.length;
    r = send(r, { type: 'LOW_CONFIDENCE_DECLINED' });
    expect(r.frame.actions.length).toBe(before);
    expect(is(r, 'f0:text:nokp')).toMatchObject({ status: 'do-it-yourself', diyReason: 'DECLINED' });
    expect(r.state.current).toBe('f0:text:tlahir');
    expect(r.frame.values.has('f0:text:nokp')).toBe(false);
  });

  it('declining the last question goes to the review screen', () => {
    let r = open(toFirstQuestion(['f0:checkbox:akuan']), 'f0:checkbox:akuan');
    r = send(r, { type: 'LOW_CONFIDENCE_DECLINED' });
    expect(r.state.phase).toBe('review');
  });

  it('a declined required field is listed as do it yourself and does not block the confirm by itself', () => {
    let r = open(toFirstQuestion(['f0:text:tel']), 'f0:text:tel');
    r = send(r, { type: 'LOW_CONFIDENCE_DECLINED' });
    for (let i = 0; i < 20 && r.state.phase === 'asking'; i++) r = answerOpen(r);
    expect(r.state.phase).toBe('review');
    expect(is(r, 'f0:text:tel').status).toBe('do-it-yourself');
  });

  it('accept and decline do nothing outside a question that needs the check', () => {
    const r = toFirstQuestion([]);
    expect(agentReducer(r.state, { type: 'LOW_CONFIDENCE_ACCEPTED' }).state).toBe(r.state);
    expect(agentReducer(r.state, { type: 'LOW_CONFIDENCE_DECLINED' }).state).toBe(r.state);
  });
});
