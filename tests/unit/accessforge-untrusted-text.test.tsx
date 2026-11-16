// @vitest-environment jsdom
/**
 * tests/unit/accessforge-untrusted-text.test.tsx
 *
 * accessforge-skeleton task 16.13: AI-written labels and questions are
 * untrusted text. A question holding a link, a javascript: URL and a selector
 * renders literally with no `a` element, and nothing in the frame changes.
 * Validates: Requirement 6.17
 */

import { describe, it, expect, afterEach } from 'vitest';
import { MirrorStep } from '../../src/frontend/accessforge/MirrorStep.js';
import { MirrorReview } from '../../src/frontend/accessforge/MirrorReview.js';
import type { AgentEvent, AgentState } from '../../src/lib/accessforge/agent-machine.js';
import { validatePlan } from '../../src/lib/accessforge/plan-validator.js';
import { MODEL } from './accessforge-helpers.js';
import { answerAll, fresh, send } from './accessforge-machine-helpers.js';
import { render, withApp, type Rendered } from './accessforge-render.js';

const HOSTILE = '<a href="https://example.com">x</a> javascript:alert(1) #nama';
const TYPES: Record<string, string> = {
  'f0:text:nama': 'text', 'f0:text:nokp': 'ic', 'f0:text:tlahir': 'date', 'f0:radio:jantina': 'radio',
  'f0:text:tel': 'phone', 'f0:text:poskod': 'postcode', 'f0:select:tujuan': 'dropdown', 'f0:checkbox:akuan': 'checkbox',
};

function hostileRun() {
  const plan = validatePlan(MODEL, Object.entries(TYPES).map(([elementId, answerType]) => ({ elementId, humanLabel: HOSTILE.slice(0, 80), question: HOSTILE, answerType, confidence: 0.9 })));
  let r = fresh();
  r = send(r, { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true });
  r = send(send(r, { type: 'REVIVE_PRESSED' }), { type: 'NOTICE_ACKNOWLEDGED' });
  r = send(r, { type: 'MODEL_READY', generation: 1, model: MODEL });
  return send(r, { type: 'PLAN_READY', generation: 1, analysisMode: 'live', plan });
}

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('untrusted model text', () => {
  it.each(['f0:text:nama', 'f0:radio:jantina', 'f0:select:tujuan'])('renders the %s step literally with no link', (id) => {
    const r = hostileRun();
    const state: AgentState = { ...r.state, current: id };
    const events: AgentEvent[] = [];
    view = render(withApp(<MirrorStep state={state} field={state.fields.find((f) => f.elementId === id)!} dispatch={(e) => events.push(e)} />));
    expect(view.container.querySelector('a')).toBeNull();
    expect(view.container.textContent).toContain(HOSTILE);
    expect(events).toEqual([]);
    expect(r.frame.actions).toEqual([]);
  });

  it('renders the review rows literally, and the plan text names no Element_Id or navigation', () => {
    const r = answerAll(hostileRun());
    expect(r.state.phase).toBe('review');
    view = render(withApp(<MirrorReview state={r.state} dispatch={() => {}} />));
    expect(view.container.querySelector('a')).toBeNull();
    expect(view.container.textContent).toContain(HOSTILE);
    // Every write targets the field the user answered, never "#nama" or a URL.
    expect(r.frame.actions.every((a) => a.elementId.startsWith('f0:'))).toBe(true);
    expect(r.frame.actions.some((a) => a.kind === 'click')).toBe(false);
  });
});
