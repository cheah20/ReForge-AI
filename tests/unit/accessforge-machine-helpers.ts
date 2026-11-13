/**
 * tests/unit/accessforge-machine-helpers.ts
 *
 * A scripted driver for the agent-loop reducer: a fake frame that answers
 * EXECUTE and READ_BACK effects the way useAgentLoop will, and the
 * Synthetic_Registration answers. Not a test file. Needs jsdom (the model
 * comes from the parsed registration page).
 */

import { agentReducer, initialAgentState, type AgentEvent, type AgentState, type Effect } from '../../src/lib/accessforge/agent-machine.js';
import type { MirrorAnswer } from '../../src/lib/accessforge/transformations.js';
import type { ReadBackResult } from '../../src/lib/accessforge/verifier.js';
import type { Action } from '../../src/shared/page-schemas.js';
import { MODEL, planFor } from './accessforge-helpers.js';

export const TODAY = new Date(Date.UTC(2026, 10, 17));

export const ANSWERS: Record<string, MirrorAnswer> = {
  'f0:text:nama': { kind: 'text', value: '  LIN MEI TEST ' },
  'f0:text:nokp': { kind: 'text', value: '900101-10-1234' },
  'f0:text:tlahir': { kind: 'date', parts: { day: '1', month: '1', year: '1990' } },
  'f0:radio:jantina': { kind: 'option', value: 'P' },
  'f0:text:tel': { kind: 'text', value: '+60 11-2345 6789' },
  'f0:text:poskod': { kind: 'text', value: '43000' },
  'f0:select:tujuan': { kind: 'option', value: 'PERIKSA' },
  'f0:checkbox:akuan': { kind: 'consent', checked: true },
};

/** A fake legacy form: field Element_Id -> value (string) or checked (boolean). */
export class FakeFrame {
  values = new Map<string, string | boolean>();
  actions: Action[] = [];
  clicks = 0;
  /** Changes what the next read-backs see (a page script or the user editing the frame). */
  tamper: ((id: string, v: string | boolean | undefined) => string | boolean | undefined) | null = null;

  apply(a: Action): void {
    this.actions.push(a);
    if (a.kind === 'click') {
      this.clicks++;
      return;
    }
    if (a.kind === 'check' && a.elementId.startsWith('f0:radio:')) {
      const group = a.elementId.split(':').slice(0, 3).join(':');
      this.values.set(group, decodeURIComponent(a.elementId.split(':')[3]!));
      return;
    }
    this.values.set(a.elementId, a.kind === 'check' ? a.checked : a.value);
  }

  read(id: string): ReadBackResult {
    const entry = MODEL.entries.find((e) => e.elementId === id)!;
    let v = this.values.get(id);
    if (this.tamper) v = this.tamper(id, v);
    if (entry.control === 'checkbox') return { kind: 'checkbox', checked: v === true };
    if (entry.control === 'radio') return { kind: 'radio', value: typeof v === 'string' ? v : null };
    return { kind: entry.control === 'select' ? 'select' : 'text', value: typeof v === 'string' ? v : '' };
  }
}

export interface Run {
  state: AgentState;
  effects: Effect[];
  frame: FakeFrame;
}

/** Applies an event; EXECUTE and READ_BACK effects are answered by the fake frame until none are left. */
export function send(run: Run, event: AgentEvent): Run {
  let { state } = run;
  const all: Effect[] = [];
  const queue: AgentEvent[] = [event];
  while (queue.length > 0) {
    const step = agentReducer(state, queue.shift()!);
    state = step.state;
    for (const fx of step.effects) {
      all.push(fx);
      if (fx.type === 'EXECUTE') {
        run.frame.apply(fx.action);
        if (fx.action.kind !== 'click') queue.push({ type: 'ACTION_DONE', generation: fx.generation, elementId: fieldOf(fx.action.elementId) });
      }
      if (fx.type === 'READ_BACK') queue.push({ type: 'READ_BACK_DONE', generation: fx.generation, elementId: fx.elementId, result: run.frame.read(fx.elementId) });
    }
  }
  return { state, effects: all, frame: run.frame };
}

/** A radio option id names its group's field. */
export function fieldOf(id: string): string {
  return id.startsWith('f0:radio:') ? id.split(':').slice(0, 3).join(':') : id;
}

export function fresh(): Run {
  return { state: initialAgentState('en'), effects: [], frame: new FakeFrame() };
}

/** Frame loaded, revive pressed, notice acknowledged, model and plan ready: the first question is open. */
export function toFirstQuestion(plan = planFor()): Run {
  let r = fresh();
  r = send(r, { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true });
  r = send(r, { type: 'REVIVE_PRESSED' });
  r = send(r, { type: 'NOTICE_ACKNOWLEDGED' });
  r = send(r, { type: 'MODEL_READY', generation: 1, model: MODEL });
  r = send(r, { type: 'PLAN_READY', generation: 1, analysisMode: 'mock', plan });
  return r;
}

/** Answers every open question with ANSWERS until the review screen. */
export function answerAll(r: Run): Run {
  for (let i = 0; i < 20 && r.state.phase === 'asking'; i++) {
    r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[r.state.current!]!, today: TODAY });
  }
  return r;
}

export const count = (effects: Effect[], type: Effect['type']) => effects.filter((e) => e.type === type).length;
export const clicks = (effects: Effect[]) => effects.filter((e) => e.type === 'EXECUTE' && e.action.kind === 'click').length;
