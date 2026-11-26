// @vitest-environment jsdom
/**
 * tests/unit/accessforge-components.test.tsx
 *
 * accessforge-skeleton task 16.12: the Mirror components.
 * Validates: Requirements 6.14, 7.5, 7.11, 11.3, 12.2, 14.7, 14.10, 18.6
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { AgentEvent, AgentState } from '../../src/lib/accessforge/agent-machine.js';
import { ModeNotice, ScopeNotice } from '../../src/frontend/accessforge/notices.js';
import { MirrorStep } from '../../src/frontend/accessforge/MirrorStep.js';
import { MirrorResult } from '../../src/frontend/accessforge/MirrorResult.js';
import { DoItYourselfList } from '../../src/frontend/accessforge/MirrorReview.js';
import { MirrorHeader, hasUnsentAnswers } from '../../src/frontend/accessforge/RevivalScreen.js';
import type { ChangeLanguage } from '../../src/frontend/use-change-language.js';
import { MODEL, planFor } from './accessforge-helpers.js';
import { ANSWERS, TODAY, answerAll, fresh, send, toFirstQuestion } from './accessforge-machine-helpers.js';
import { fire, render, withApp, type Rendered } from './accessforge-render.js';
import { SAMPLE_FORM_PATH } from '../../src/shared/app-paths.js';

const CHANGE: ChangeLanguage = { change: async () => {}, busy: false, errorKey: null } as unknown as ChangeLanguage;

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});
const show = (node: Parameters<typeof withApp>[0]) => (view = render(withApp(node))).container;

function done(): AgentState {
  let r = answerAll(toFirstQuestion());
  r = send(r, { type: 'CONFIRM_PRESSED' });
  r = send(r, { type: 'FRAME_LOADED', generation: 3, page: 'confirmation', versionSupported: false });
  return send(r, { type: 'RESULT_VERIFIED', generation: 3, differences: [], reference: 'SR-DEMO-20261117-042137', originalText: 'Sila simpan nombor rujukan ini.' }).state;
}

describe('ModeNotice', () => {
  it.each([
    ['live', 'AI wrote these questions from the page.'],
    ['mock', 'These are simulated demonstration questions. No AI analysed the page.'],
    ['cached', 'Live AI was unavailable'],
  ] as const)('shows the %s notice with an icon and words', (mode, text) => {
    const root = show(<ModeNotice mode={mode} />);
    expect(root.textContent).toContain(text);
    expect(root.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows nothing before analysis', () => {
    expect(show(<ModeNotice mode={null} />).textContent).toBe('');
  });
});

describe('MirrorStep', () => {
  it.each(['live', 'mock', 'cached'] as const)('labels plan text as machine-translated in %s mode', (mode) => {
    const state = { ...toFirstQuestion().state, analysisMode: mode };
    const root = show(<MirrorStep state={state} field={state.fields[0]!} dispatch={() => {}} />);
    expect(root.textContent).toContain('Machine translated');
  });

  it('sets aria-invalid with an error and removes it when the error is gone', () => {
    const base = toFirstQuestion().state;
    const withError = { ...base, fields: base.fields.map((f, i) => (i === 0 ? { ...f, error: { messageKey: 'validation.required' } } : f)) };
    const root = show(<MirrorStep state={withError} field={withError.fields[0]!} dispatch={() => {}} />);
    expect(root.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
    view!.rerender(withApp(<MirrorStep state={base} field={base.fields[0]!} dispatch={() => {}} />));
    expect(root.querySelector('input')!.hasAttribute('aria-invalid')).toBe(false);
  });

  it('moves focus to the step heading on each new step', () => {
    let r = toFirstQuestion();
    const root = show(<MirrorStep state={r.state} field={r.state.fields[0]!} dispatch={() => {}} />);
    expect(document.activeElement).toBe(root.querySelector('h1'));
    expect(document.activeElement?.textContent).toBe(r.state.fields[0]!.plan!.humanLabel);
    r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    const next = r.state.fields.find((f) => f.elementId === r.state.current)!;
    view!.rerender(withApp(<MirrorStep state={r.state} field={next} dispatch={() => {}} />));
    expect(document.activeElement?.textContent).toBe(next.plan!.humanLabel);
  });

  it('cancel asks the loop, it never cancels by itself', () => {
    const events: AgentEvent[] = [];
    const state = toFirstQuestion().state;
    const root = show(<MirrorStep state={state} field={state.fields[0]!} dispatch={(e) => events.push(e)} />);
    fire(() => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!.click());
    expect(events).toEqual([{ type: 'CANCEL_PRESSED' }]);
  });
});

describe('MirrorResult', () => {
  it('shows the reference exactly as read and keeps focus on the show-original toggle', () => {
    const root = show(<MirrorResult state={done()} dispatch={() => {}} />);
    expect(root.textContent).toContain('Reference number: SR-DEMO-20261117-042137');
    const toggle = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Show the original confirmation')!;
    toggle.focus();
    fire(() => toggle.click());
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide the original confirmation');
    const original = root.querySelector('p[lang="ms"]')!;
    expect(original.textContent).toBe('Sila simpan nombor rujukan ini.');
    expect(original.closest('[hidden]')).toBeNull();
  });

  it('says the original text is unavailable and shows no substitute', () => {
    const state = done();
    const root = show(<MirrorResult state={{ ...state, result: { ...state.result!, originalText: null } }} dispatch={() => {}} />);
    expect(root.textContent).toContain('The original confirmation text is not available.');
    expect(root.querySelector('[lang="ms"]')).toBeNull();
  });

  it('always links to the sample form with no answer in the link', () => {
    const root = show(<MirrorResult state={done()} dispatch={() => {}} />);
    const links = Array.from(root.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([SAMPLE_FORM_PATH]);
    expect(root.textContent).toContain('Every field was filled.');
  });
});

describe('do it yourself and scope', () => {
  it('lists do-it-yourself fields with the legacy label in Malay and a plain reason, no value', () => {
    const r = toFirstQuestion(planFor(['f0:text:nama']));
    const diy = r.state.fields.filter((f) => f.status === 'do-it-yourself');
    expect(diy).toHaveLength(7);
    const root = show(<DoItYourselfList fields={diy} />);
    const labels = Array.from(root.querySelectorAll('[lang="ms"]')).map((e) => e.textContent);
    expect(labels).toEqual(diy.map((f) => f.entry.neighbourText));
    expect(root.textContent).toContain('We could not work out what this field asks.');
  });

  it('shows the scope notice, and the only-demo message for a foreign address', () => {
    expect(show(<ScopeNotice foreignAddress={false} />).textContent).not.toContain('Nothing was loaded');
    view!.unmount();
    view = null;
    const root = show(<ScopeNotice foreignAddress />);
    expect(root.textContent).toContain('Nothing was loaded from the address you gave.');
    expect(root.textContent).toContain('revives only the fictional demonstration portal');
  });
});

describe('MirrorHeader', () => {
  it('locks the language picker with a note until the questions exist, and frees it after', () => {
    const idle = send(fresh(), { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true }).state;
    const root = show(<MirrorHeader state={idle} changeLanguage={CHANGE} largeText={false} onLargeText={() => {}} />);
    expect(root.querySelector('select')!.disabled).toBe(false);
    let reading = send(send(send(fresh(), { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true }), { type: 'REVIVE_PRESSED' }), { type: 'NOTICE_ACKNOWLEDGED' });
    reading = send(reading, { type: 'MODEL_READY', generation: 1, model: MODEL });
    view!.rerender(withApp(<MirrorHeader state={reading.state} changeLanguage={CHANGE} largeText={false} onLargeText={() => {}} />));
    const select = root.querySelector('select')!;
    expect(select.disabled).toBe(true);
    expect(document.getElementById(select.getAttribute('aria-describedby')!)?.textContent).toBe('You can change the language when the questions are ready.');
    view!.rerender(withApp(<MirrorHeader state={toFirstQuestion().state} changeLanguage={CHANGE} largeText={false} onLargeText={() => {}} />));
    expect(root.querySelector('select')!.disabled).toBe(false);
  });

  it('counts unsent answers for the leave warning until a confirmation arrives', () => {
    const r = send(toFirstQuestion(), { type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    expect(hasUnsentAnswers(toFirstQuestion().state)).toBe(false);
    expect(hasUnsentAnswers(r.state)).toBe(true);
    expect(hasUnsentAnswers(done())).toBe(false);
  });
});
