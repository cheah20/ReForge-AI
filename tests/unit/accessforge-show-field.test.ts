// @vitest-environment jsdom
/**
 * tests/unit/accessforge-show-field.test.ts
 *
 * accessforge-skeleton task 26.3 (Slice 2, Requirement 12.2): on the review
 * screen a do-it-yourself field can be shown on the old page. The runner
 * outlines the control in the frame; it reads the frame and writes nothing.
 * Validates: Requirements 12.2
 */

import { describe, it, expect, vi } from 'vitest';
import { LoopRunner } from '../../src/frontend/accessforge/loop-runner.js';
import { fieldById, needsConfidenceCheck } from '../../src/lib/accessforge/agent-machine.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import type { PageAnalyzeRequest, PageAnalyzeResponse } from '../../src/shared/page-schemas.js';
import type { ApiReply } from '../../src/frontend/api.js';
import { ANSWERS, TODAY } from './accessforge-machine-helpers.js';

const ORIGIN = window.location.origin;
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const flush = () => new Promise((r) => setTimeout(r, 0));
const OMITTED = 'f0:text:tel';

class FakeFrame {
  doc: Document | null = null;
  src = '';
  get contentDocument() {
    return this.doc;
  }
  get contentWindow() {
    return { location: new URL('/legacy/register', ORIGIN) };
  }
}

/** The mock plan without the phone field, so that field becomes do it yourself. */
async function analyzeWithoutPhone(request: PageAnalyzeRequest): Promise<ApiReply<PageAnalyzeResponse>> {
  const reply = await new MockAiProvider().analyzePage({ request, interfaceLanguageName: 'English' });
  const entries = (reply.value as { entries: PageAnalyzeResponse['entries'] }).entries.filter((e) => e.elementId !== OMITTED);
  return { data: { analysisMode: 'mock', entries }, aiMode: 'mock' };
}

async function toReview() {
  const frame = new FakeFrame();
  const highlight = vi.fn();
  const runner = new LoopRunner(
    { frame: () => frame as unknown as HTMLIFrameElement, appOrigin: ORIGIN, analyze: analyzeWithoutPhone, highlight, setTimer: () => 0, clearTimer: () => {} },
    'en',
  );
  frame.doc = parse(fill(TEMPLATES.register, {}));
  runner.onFrameLoad();
  runner.dispatch({ type: 'REVIVE_PRESSED' });
  runner.dispatch({ type: 'NOTICE_ACKNOWLEDGED' });
  await flush();
  for (let i = 0; i < 12 && runner.get().phase === 'asking'; i++) {
    if (needsConfidenceCheck(fieldById(runner.get(), runner.get().current!)!)) runner.dispatch({ type: 'LOW_CONFIDENCE_ACCEPTED' });
    runner.dispatch({ type: 'NEXT_PRESSED', answer: ANSWERS[runner.get().current!]!, today: TODAY });
  }
  return { frame, runner, highlight };
}

describe('LoopRunner.showField (12.2)', () => {
  it('outlines a do-it-yourself field on the review screen and writes nothing', async () => {
    const { frame, runner, highlight } = await toReview();
    expect(runner.get().phase).toBe('review');
    expect(fieldById(runner.get(), OMITTED)?.status).toBe('do-it-yourself');
    highlight.mockClear();
    const phone = frame.doc!.querySelector('input[name="tel"]') as HTMLInputElement;
    const snapshot = JSON.stringify(Array.from(frame.doc!.querySelectorAll('input,select')).map((e) => [e.getAttribute('name'), (e as HTMLInputElement).value, (e as HTMLInputElement).checked]));

    expect(runner.showField(OMITTED)).toBe(true);

    expect(highlight).toHaveBeenCalledTimes(1);
    expect(highlight.mock.calls[0]![0]).toBe(phone);
    expect(JSON.stringify(Array.from(frame.doc!.querySelectorAll('input,select')).map((e) => [e.getAttribute('name'), (e as HTMLInputElement).value, (e as HTMLInputElement).checked]))).toBe(snapshot);
    expect(phone.value).toBe('');
  });

  it('shows nothing for an unknown id', async () => {
    const { runner, highlight } = await toReview();
    highlight.mockClear();
    expect(runner.showField('f0:text:nope')).toBe(false);
    expect(highlight).not.toHaveBeenCalled();
  });

  it('shows nothing outside the review screen', async () => {
    const frame = new FakeFrame();
    const highlight = vi.fn();
    const runner = new LoopRunner({ frame: () => frame as unknown as HTMLIFrameElement, appOrigin: ORIGIN, analyze: analyzeWithoutPhone, highlight, setTimer: () => 0, clearTimer: () => {} }, 'en');
    frame.doc = parse(fill(TEMPLATES.register, {}));
    runner.onFrameLoad();
    expect(runner.showField('f0:text:nama')).toBe(false);
    expect(highlight).not.toHaveBeenCalled();
  });

  it('shows nothing when the frame document was replaced', async () => {
    const { frame, runner, highlight } = await toReview();
    highlight.mockClear();
    frame.doc = parse(fill(TEMPLATES.register, {}));
    expect(runner.showField(OMITTED)).toBe(false);
    expect(highlight).not.toHaveBeenCalled();
  });
});
