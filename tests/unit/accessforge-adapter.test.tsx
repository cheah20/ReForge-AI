// @vitest-environment jsdom
/**
 * tests/unit/accessforge-adapter.test.tsx
 *
 * accessforge-skeleton tasks 16.6, 16.7 and 16.18: the adapter output renders
 * in FormBridge's FieldQuestion with the question, the original label with
 * lang="ms" and only the Page_Model options; the date and consent steps.
 * Validates: Requirements 9.7, 9.8, 9.14, 6.9, 6.11
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { AgentEvent, AgentState, MirrorField } from '../../src/lib/accessforge/agent-machine.js';
import { toFieldState } from '../../src/frontend/accessforge/mirror-field-adapter.js';
import { MirrorStep } from '../../src/frontend/accessforge/MirrorStep.js';
import { answerAll, toFirstQuestion, send, ANSWERS, TODAY } from './accessforge-machine-helpers.js';
import { fire, render, typeInto, withApp, type Rendered } from './accessforge-render.js';

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function at(id: string): AgentState {
  let r = toFirstQuestion();
  for (let i = 0; i < 10 && r.state.current !== id; i++) r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[r.state.current!]!, today: TODAY });
  if (r.state.current !== id) throw new Error(`did not reach ${id}`);
  return r.state;
}

function show(state: AgentState, events: AgentEvent[] = []) {
  const field = state.fields.find((f) => f.elementId === state.current)!;
  view = render(withApp(<MirrorStep state={state} field={field} dispatch={(e) => events.push(e)} />));
  return { root: view.container, field, events };
}

describe('toFieldState', () => {
  it('maps a Mirror field as the design table says, with no maxLength', () => {
    const field = at('f0:select:tujuan').fields.find((f) => f.elementId === 'f0:select:tujuan')!;
    const s = toFieldState(field);
    expect(s.status).toBe('mapped');
    expect(s.evidence).toMatchObject({ fieldId: 'f0:select:tujuan', fieldType: 'dropdown', tooltip: 'Tujuan*', required: true, readOnly: false, hasValue: false });
    expect(s.evidence.maxLength).toBeUndefined();
    expect(s.evidence.options).toEqual(field.entry.options.map((o) => ({ exportValue: o.value, displayLabel: o.text })));
    expect(s.analysis).toEqual({ fieldId: field.elementId, humanLabel: field.plan!.humanLabel, question: field.plan!.question, answerType: 'dropdown', confidence: field.plan!.confidence });
  });

  it('refuses a checkbox and a do-it-yourself field instead of guessing', () => {
    const state = at('f0:checkbox:akuan');
    expect(() => toFieldState(state.fields.find((f) => f.entry.control === 'checkbox')!)).toThrow(TypeError);
    const diy: MirrorField = { ...state.fields[0]!, plan: null, status: 'do-it-yourself' };
    expect(() => toFieldState(diy)).toThrow(TypeError);
  });
});

describe('FieldQuestion through the adapter', () => {
  it.each(['f0:text:nama', 'f0:text:nokp', 'f0:text:tel', 'f0:text:poskod', 'f0:radio:jantina', 'f0:select:tujuan'])('%s shows the question, the original label in Malay and only Page_Model options', (id) => {
    const { root, field } = show(at(id));
    expect(root.textContent).toContain(field.plan!.question);
    const original = Array.from(root.querySelectorAll('[lang="ms"]')).map((e) => e.textContent);
    expect(original).toContain(field.entry.neighbourText);
    if (field.entry.control !== 'text') {
      const values = Array.from(root.querySelectorAll('input[type="radio"], option')).map((e) => (e as HTMLInputElement).value).filter((v) => v !== '');
      expect(values).toEqual(field.entry.options.map((o) => o.value));
    }
  });

  it('sends the typed answer exactly as typed on next', () => {
    const events: AgentEvent[] = [];
    const { root } = show(at('f0:text:nama'), events);
    typeInto(root.querySelector('input')!, '  LIN MEI TEST ');
    fire(() => root.querySelector('form')!.requestSubmit());
    expect(events).toEqual([{ type: 'NEXT_PRESSED', answer: { kind: 'text', value: '  LIN MEI TEST ' } }]);
  });

  it('links an error to the input, announces it and sets aria-invalid', () => {
    const state = at('f0:text:nokp');
    const withError = { ...state, fields: state.fields.map((f) => (f.elementId === 'f0:text:nokp' ? { ...f, error: { messageKey: 'validation.ic.invalidDate' } } : f)) };
    const { root } = show(withError);
    const input = root.querySelector('input')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const message = input.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)).find((e) => e?.getAttribute('aria-live') === 'polite');
    expect(message?.textContent).toContain('The date in this IC number is not valid');
  });

  it('shows the original evidence in Malay above the input for a low-confidence question', () => {
    const state = at('f0:select:tujuan');
    const low = { ...state, fields: state.fields.map((f) => (f.elementId === 'f0:select:tujuan' ? { ...f, plan: { ...f.plan!, confidence: 0.6 } } : f)) };
    const { root } = show(low);
    expect(root.textContent).toContain('We are not sure this question matches the old page');
    expect(root.querySelector('.mirror-evidence [lang="ms"]')?.textContent).toBe('Tujuan*');
  });
});

describe('date and consent steps', () => {
  it('asks for the date as three inputs in a fieldset and states the format', () => {
    const events: AgentEvent[] = [];
    const { root } = show(at('f0:text:tlahir'), events);
    expect(root.querySelectorAll('fieldset input[inputmode="numeric"]')).toHaveLength(3);
    expect(root.textContent).toContain('The old page expects the date as DD/MM/YYYY.');
    const [d, m, y] = Array.from(root.querySelectorAll('fieldset input')) as HTMLInputElement[];
    typeInto(d!, '1');
    typeInto(m!, '1');
    typeInto(y!, '1990');
    fire(() => root.querySelector('form')!.requestSubmit());
    expect(events).toEqual([{ type: 'NEXT_PRESSED', answer: { kind: 'date', parts: { day: '1', month: '1', year: '1990' } } }]);
  });

  it('asks the consent question as one unticked checkbox with the original wording on request in Malay', () => {
    const events: AgentEvent[] = [];
    const { root, field } = show(at('f0:checkbox:akuan'), events);
    const boxes = root.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(1);
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
    const toggle = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Show the original wording')!;
    const original = root.querySelector('p[lang="ms"]')!;
    expect(original.closest('[hidden]')).not.toBeNull();
    fire(() => toggle.click());
    expect(original.closest('[hidden]')).toBeNull();
    expect(original.textContent).toContain(field.entry.nextRowText);
    fire(() => root.querySelector('form')!.requestSubmit());
    expect(events).toEqual([{ type: 'NEXT_PRESSED', answer: { kind: 'consent', checked: false } }]);
  });

  it('reaches review with every step answered through the components (sanity)', () => {
    expect(answerAll(toFirstQuestion()).state.phase).toBe('review');
  });
});
