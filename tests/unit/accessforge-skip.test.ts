// @vitest-environment jsdom
/**
 * tests/unit/accessforge-skip.test.ts
 *
 * accessforge-skeleton task 26.1 (Slice 2): skipping a question the legacy
 * form does not require. The field stays empty; a value written earlier is
 * cleared with one Action of the kind of the control and read back.
 * Validates: Requirements 8.11, 9.12
 */

import { describe, it, expect } from 'vitest';
import { reviewRows } from '../../src/lib/accessforge/agent-machine.js';
import { validatePlan } from '../../src/lib/accessforge/plan-validator.js';
import type { PageModel } from '../../src/shared/page-schemas.js';
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

/** The registration model with some fields not required, as a page of Slice 2 might have. */
function modelWith(optional: string[], over: (id: string) => object = () => ({})): PageModel {
  return { ...MODEL, entries: MODEL.entries.map((e) => (optional.includes(e.elementId) ? { ...e, required: false, ...over(e.elementId) } : e)) } as PageModel;
}

function toFirstQuestion(model: PageModel): Run {
  const plan = validatePlan(
    model,
    Object.keys(TYPES).map((elementId) => ({ elementId, humanLabel: 'Label', question: 'Question?', answerType: TYPES[elementId], confidence: 0.9 })),
  );
  let r = fresh();
  r = send(r, { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true });
  r = send(r, { type: 'REVIVE_PRESSED' });
  r = send(r, { type: 'NOTICE_ACKNOWLEDGED' });
  r = send(r, { type: 'MODEL_READY', generation: 1, model });
  r = send(r, { type: 'PLAN_READY', generation: 1, analysisMode: 'mock', plan });
  return r;
}

const answerOpen = (r: Run): Run => send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[r.state.current!]!, today: TODAY });

/** Answers questions until `id` is open. */
function openStep(r: Run, id: string): Run {
  for (let i = 0; i < 20 && r.state.current !== id; i++) r = answerOpen(r);
  expect(r.state.current).toBe(id);
  return r;
}

const toReview = (r: Run): Run => {
  for (let i = 0; i < 20 && r.state.phase === 'asking'; i++) r = answerOpen(r);
  return r;
};

const OPTIONAL = ['f0:text:tel', 'f0:radio:jantina', 'f0:select:tujuan'];
const fieldOf = (r: Run, id: string) => r.state.fields.find((f) => f.elementId === id)!;

describe('SKIP_PRESSED (8.11, 9.12)', () => {
  it('does nothing on a required question', () => {
    let r = toFirstQuestion(modelWith(OPTIONAL));
    const before = r.state;
    r = send(r, { type: 'SKIP_PRESSED' });
    expect(r.state).toBe(before);
    expect(r.frame.actions).toEqual([]);
  });

  it('skips a question not yet answered: nothing is written, the status is skipped, the next question opens', () => {
    let r = openStep(toFirstQuestion(modelWith(OPTIONAL)), 'f0:radio:jantina');
    r = send(r, { type: 'SKIP_PRESSED' });
    expect(r.frame.values.has('f0:radio:jantina')).toBe(false);
    expect(r.frame.actions.filter((a) => a.elementId.startsWith('f0:radio:'))).toEqual([]);
    expect(fieldOf(r, 'f0:radio:jantina').status).toBe('skipped');
    expect(r.state.current).toBe('f0:text:tel');
  });

  it('clears a text value written earlier with one empty fill and marks the field skipped', () => {
    let r = openStep(toFirstQuestion(modelWith(OPTIONAL)), 'f0:text:tel');
    r = answerOpen(r);
    expect(r.frame.values.get('f0:text:tel')).toBe('011-2345 6789');
    r = send(r, { type: 'BACK_PRESSED' });
    expect(r.state.current).toBe('f0:text:tel');
    const before = r.frame.actions.length;
    r = send(r, { type: 'SKIP_PRESSED' });
    expect(r.frame.actions.slice(before)).toEqual([{ kind: 'fill', elementId: 'f0:text:tel', value: '' }]);
    expect(r.frame.values.get('f0:text:tel')).toBe('');
    const field = fieldOf(r, 'f0:text:tel');
    expect(field.status).toBe('skipped');
    expect(field.intended).toBeUndefined();
    expect(field.answer).toBeUndefined();
  });

  it('clears a radio choice with one unchecked check on the checked option', () => {
    let r = openStep(toFirstQuestion(modelWith(OPTIONAL)), 'f0:radio:jantina');
    r = answerOpen(r);
    expect(r.frame.values.get('f0:radio:jantina')).toBe('P');
    r = send(r, { type: 'BACK_PRESSED' });
    const before = r.frame.actions.length;
    r = send(r, { type: 'SKIP_PRESSED' });
    const cleared = r.frame.actions.slice(before);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ kind: 'check', checked: false });
    expect(r.frame.values.has('f0:radio:jantina')).toBe(false);
    expect(fieldOf(r, 'f0:radio:jantina').status).toBe('skipped');
  });

  it('clears a select with the empty option', () => {
    let r = toReview(toFirstQuestion(modelWith(OPTIONAL)));
    expect(r.frame.values.get('f0:select:tujuan')).toBe('PERIKSA');
    r = send(r, { type: 'EDIT_PRESSED', elementId: 'f0:select:tujuan' });
    r = send(r, { type: 'SKIP_PRESSED' });
    expect(r.frame.actions.at(-1)).toEqual({ kind: 'select', elementId: 'f0:select:tujuan', value: '' });
    expect(r.frame.values.get('f0:select:tujuan')).toBe('');
    expect(fieldOf(r, 'f0:select:tujuan').status).toBe('skipped');
  });

  it('a select with no empty option cannot be cleared: it becomes do it yourself', () => {
    let r = toReview(toFirstQuestion(modelWith(['f0:select:tujuan'], () => ({ hasEmptyOption: false }))));
    r = send(r, { type: 'EDIT_PRESSED', elementId: 'f0:select:tujuan' });
    const before = r.frame.actions.length;
    r = send(r, { type: 'SKIP_PRESSED' });
    expect(r.frame.actions.length).toBe(before);
    expect(fieldOf(r, 'f0:select:tujuan').status).toBe('do-it-yourself');
  });

  it('returns to the review screen when the question was opened from it', () => {
    let r = toReview(toFirstQuestion(modelWith(OPTIONAL)));
    expect(r.state.phase).toBe('review');
    r = send(r, { type: 'EDIT_PRESSED', elementId: 'f0:text:tel' });
    r = send(r, { type: 'SKIP_PRESSED' });
    expect(r.state.phase).toBe('review');
    expect(reviewRows(r.state).find((row) => row.field.elementId === 'f0:text:tel')?.status).toBe('skipped');
  });

  it('a skipped field is not read back at confirm, and submit still needs one confirm press', () => {
    let r = openStep(toFirstQuestion(modelWith(OPTIONAL)), 'f0:text:tel');
    r = send(r, { type: 'SKIP_PRESSED' });
    r = toReview(r);
    expect(r.state.phase).toBe('review');
    expect(r.frame.clicks).toBe(0);
    r = send(r, { type: 'CONFIRM_PRESSED' });
    const read = r.effects.filter((e) => e.type === 'READ_BACK').map((e) => (e.type === 'READ_BACK' ? e.elementId : ''));
    expect(read).not.toContain('f0:text:tel');
    expect(r.frame.clicks).toBe(1);
  });
});
