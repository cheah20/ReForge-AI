// @vitest-environment jsdom
/**
 * tests/unit/accessforge-loop-runner.test.ts
 *
 * accessforge-skeleton task 16.3: the effect runner end to end in jsdom. A
 * fake iframe shows the real registration template; analysis comes from the
 * mock provider; the submit is answered by the real legacy handler with the
 * form's own body. The test checks writes, read-backs, the single submit, the
 * verified result, stale replies and the stop on an unexpected page.
 * Validates: Requirements 3.2, 3.3, 3.9, 5.1, 6.1, 8.4, 10.1, 10.10, 10.11, 12.1, 13.4
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LoopRunner } from '../../src/frontend/accessforge/loop-runner.js';
import { fieldById, needsConfidenceCheck } from '../../src/lib/accessforge/agent-machine.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { handleLegacy } from '../../src/worker/legacy/handler.js';
import { TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import type { PageAnalyzeRequest, PageAnalyzeResponse } from '../../src/shared/page-schemas.js';
import { ApiRequestError, type ApiReply } from '../../src/frontend/api.js';
import { DEPS } from './legacy-helpers.js';
import { ANSWERS, TODAY } from './accessforge-machine-helpers.js';

const ORIGIN = window.location.origin;
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** The parts of an iframe the runner and the checks read. */
class FakeFrame {
  doc: Document | null = null;
  url = new URL('/legacy/register', ORIGIN);
  src = '';
  get contentDocument() {
    return this.doc;
  }
  get contentWindow() {
    return { location: this.url };
  }
  show(path: string, doc: Document) {
    this.url = new URL(path, ORIGIN);
    this.doc = doc;
  }
}

async function mockAnalyze(request: PageAnalyzeRequest): Promise<ApiReply<PageAnalyzeResponse>> {
  const reply = await new MockAiProvider().analyzePage({ request, interfaceLanguageName: 'English' });
  return { data: { analysisMode: 'mock', entries: (reply.value as { entries: PageAnalyzeResponse['entries'] }).entries }, aiMode: 'mock' };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(analyze = mockAnalyze) {
  const frame = new FakeFrame();
  const timers: Array<() => void> = [];
  const runner = new LoopRunner(
    {
      frame: () => frame as unknown as HTMLIFrameElement,
      appOrigin: ORIGIN,
      analyze: (req) => analyze(req),
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
    },
    'en',
  );
  return { frame, runner, timers };
}

/** Load the registration page, revive, acknowledge and wait for the plan. */
async function started(analyze = mockAnalyze) {
  const s = setup(analyze);
  s.frame.show('/legacy/register', parse(fill(TEMPLATES.register, {})));
  s.runner.onFrameLoad();
  s.runner.dispatch({ type: 'REVIVE_PRESSED' });
  s.runner.dispatch({ type: 'NOTICE_ACKNOWLEDGED' });
  await flush();
  return s;
}

afterEach(() => vi.restoreAllMocks());

describe('LoopRunner', () => {
  it('runs the whole path: writes, reads back, submits once and verifies the legacy confirmation', async () => {
    const { frame, runner } = await started();
    expect(runner.get().phase).toBe('asking');
    expect(runner.get().analysisMode).toBe('mock');
    for (let i = 0; i < 10 && runner.get().phase === 'asking'; i++) {
      // A question below 0.7 confidence is accepted first (Slice 2, Requirement 6.18).
      if (needsConfidenceCheck(fieldById(runner.get(), runner.get().current!)!)) runner.dispatch({ type: 'LOW_CONFIDENCE_ACCEPTED' });
      runner.dispatch({ type: 'NEXT_PRESSED', answer: ANSWERS[runner.get().current!]!, today: TODAY });
    }
    expect(runner.get().phase).toBe('review');
    const form = frame.doc!.querySelector('form')!;
    expect((form.querySelector('input[name="nama"]') as HTMLInputElement).value).toBe('LIN MEI TEST');
    expect((form.querySelector('select') as HTMLSelectElement).value).toBe('PERIKSA');

    // The submit: capture the body the browser would send, answer it with the real handler.
    let body = '';
    const submit = vi.spyOn(window.HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (this: HTMLFormElement, submitter?: HTMLElement | null) {
      body = new URLSearchParams(new FormData(this, submitter ?? undefined) as unknown as Record<string, string>).toString();
    });
    runner.dispatch({ type: 'CONFIRM_PRESSED' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(runner.get().phase).toBe('submitting');
    expect(body).not.toContain('Hantar');

    const res = await handleLegacy(new Request(`${ORIGIN}/legacy/register`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }), DEPS);
    expect(res.status).toBe(200);
    frame.show('/legacy/register', parse(await res.text()));
    runner.onFrameLoad();
    expect(runner.get().phase).toBe('done');
    expect(runner.get().result).toMatchObject({ differences: [], reference: 'SR-DEMO-20261117-042137' });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('stops when the home page loads during the question flow, and runs no further write', async () => {
    const { frame, runner } = await started();
    runner.dispatch({ type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    frame.show('/legacy/', parse(fill(TEMPLATES.home, {})));
    runner.onFrameLoad();
    expect(runner.get().phase).toBe('stopped');
    runner.dispatch({ type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nokp']!, today: TODAY });
    expect(frame.doc!.querySelector('form')).toBeNull();
  });

  it('stops on a path outside the Allow_List and on a query string', async () => {
    for (const path of ['/legacy/admin', '/legacy/register?x=1']) {
      const { frame, runner } = await started();
      frame.show(path, parse(fill(TEMPLATES.register, {})));
      runner.onFrameLoad();
      expect(runner.get().phase).toBe('stopped');
      expect(runner.get().stopReason).toBe('pageNotSupported');
    }
  });

  it('drops an analysis reply from before a reload and aborts its request', async () => {
    let resolve: (v: ApiReply<PageAnalyzeResponse>) => void = () => {};
    let signal: AbortSignal | undefined;
    const s = setup();
    const runner = new LoopRunner(
      {
        frame: () => s.frame as unknown as HTMLIFrameElement,
        appOrigin: ORIGIN,
        analyze: (_r, o) => ((signal = o.signal), new Promise((r) => (resolve = r))),
      },
      'en',
    );
    s.frame.show('/legacy/register', parse(fill(TEMPLATES.register, {})));
    runner.onFrameLoad();
    runner.dispatch({ type: 'REVIVE_PRESSED' });
    runner.dispatch({ type: 'NOTICE_ACKNOWLEDGED' });
    expect(runner.get().phase).toBe('analysing');
    s.frame.show('/legacy/register', parse(fill(TEMPLATES.register, {})));
    runner.onFrameLoad();
    expect(signal?.aborted).toBe(true);
    resolve(await mockAnalyze({ pageModel: runner.get().model!, interfaceLanguage: 'en' }));
    await flush();
    expect(runner.get().phase).toBe('stopped');
    expect(runner.get().plan).toBeNull();
  });

  it('shows analysisFailed when the request fails, and nothing reads the page again', async () => {
    const { runner } = await started(() => Promise.reject(new ApiRequestError('AI_UNAVAILABLE')));
    expect(runner.get().phase).toBe('analysisFailed');
    expect(runner.get().errorCode).toBe('AI_UNAVAILABLE');
  });

  it('refuses a registration page with an unrecorded version and sends no analysis', async () => {
    const analyze = vi.fn(mockAnalyze);
    const s = setup(analyze);
    const doc = parse(fill(TEMPLATES.register, {}));
    doc.querySelector('meta[name="portal-page-version"]')!.setAttribute('content', '0'.repeat(64));
    s.frame.show('/legacy/register', doc);
    s.runner.onFrameLoad();
    s.runner.dispatch({ type: 'REVIVE_PRESSED' });
    s.runner.dispatch({ type: 'NOTICE_ACKNOWLEDGED' });
    await flush();
    expect(s.runner.get().phase).toBe('versionUnsupported');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('writes nothing to browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { runner } = await started();
    runner.dispatch({ type: 'NEXT_PRESSED', answer: ANSWERS['f0:text:nama']!, today: TODAY });
    expect(setItem).not.toHaveBeenCalled();
  });
});
